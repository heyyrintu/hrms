'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  preOnboardingApi,
  type PublicPreOnboarding,
  type PublicPreOnboardingDocument,
} from '@/lib/api-careers';
import type { PreOnboardingPersonalDetails } from '@/lib/api-recruitment';
import { apiErrorMessage, formatDay, isNotFound } from '@/components/recruitment/careers/careersFormat';

const NOT_FOUND_MESSAGE = 'This pre-onboarding link is invalid or has expired';
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const DETAIL_FIELDS: Array<{ key: keyof PreOnboardingPersonalDetails; label: string; type?: string }> = [
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { key: 'gender', label: 'Gender' },
  { key: 'maritalStatus', label: 'Marital status' },
  { key: 'bloodGroup', label: 'Blood group' },
  { key: 'fatherName', label: "Father's name" },
  { key: 'personalEmail', label: 'Personal email', type: 'email' },
  { key: 'mobileNumber', label: 'Mobile number' },
  { key: 'currentAddress', label: 'Current address' },
  { key: 'currentCity', label: 'Current city' },
  { key: 'currentState', label: 'Current state' },
  { key: 'currentZipCode', label: 'Current PIN/ZIP code' },
  { key: 'currentCountry', label: 'Current country' },
  { key: 'permanentAddress', label: 'Permanent address' },
  { key: 'permanentCity', label: 'Permanent city' },
  { key: 'permanentState', label: 'Permanent state' },
  { key: 'permanentZipCode', label: 'Permanent PIN/ZIP code' },
  { key: 'permanentCountry', label: 'Permanent country' },
  { key: 'emergencyContactName', label: 'Emergency contact name' },
  { key: 'emergencyContactNumber', label: 'Emergency contact number' },
  { key: 'emergencyContactRelation', label: 'Emergency contact relation' },
];

const LOCKED_STATUSES = ['SUBMITTED', 'COMPLETED'];

function detailsToForm(details: PreOnboardingPersonalDetails | null): Record<string, string> {
  const form: Record<string, string> = {};
  for (const field of DETAIL_FIELDS) {
    const value = details?.[field.key];
    form[field.key] = value ?? '';
  }
  return form;
}

/** Public pre-onboarding portal: `/pre-onboarding/:token`. */
export default function PreOnboardingPortalPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token as string) ?? '';

  const [data, setData] = useState<PublicPreOnboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [form, setForm] = useState<Record<string, string>>({});
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);

  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    try {
      const res = await preOnboardingApi.get(token);
      setData(res.data);
      setForm(detailsToForm(res.data.personalDetails));
    } catch (error) {
      if (isNotFound(error)) setNotFound(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const locked = data ? LOCKED_STATUSES.includes(data.status) : true;

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingDetails(true);
    setDetailsError(null);
    setDetailsSaved(false);
    try {
      const payload: PreOnboardingPersonalDetails = {};
      for (const field of DETAIL_FIELDS) {
        const value = form[field.key]?.trim() ?? '';
        (payload as Record<string, string | null>)[field.key] = value === '' ? null : value;
      }
      const res = await preOnboardingApi.saveDetails(token, payload);
      setData(res.data);
      setDetailsSaved(true);
    } catch (error) {
      if (isNotFound(error)) setNotFound(true);
      else setDetailsError(apiErrorMessage(error, 'Could not save your details. Please try again.'));
    } finally {
      setSavingDetails(false);
    }
  };

  const uploadDocument = async (doc: PublicPreOnboardingDocument, file: File | null) => {
    if (!file) return;
    setUploadErrors((prev) => ({ ...prev, [doc.key]: '' }));
    if (file.size > MAX_DOCUMENT_BYTES) {
      setUploadErrors((prev) => ({ ...prev, [doc.key]: 'File must be 5 MB or smaller' }));
      return;
    }
    if (!DOCUMENT_TYPES.includes(file.type)) {
      setUploadErrors((prev) => ({ ...prev, [doc.key]: 'File must be a PDF, JPEG or PNG' }));
      return;
    }
    setUploadingKey(doc.key);
    try {
      const res = await preOnboardingApi.uploadDocument(token, doc.key, file);
      setData(res.data);
    } catch (error) {
      if (isNotFound(error)) setNotFound(true);
      else setUploadErrors((prev) => ({ ...prev, [doc.key]: apiErrorMessage(error, 'Upload failed. Please try again.') }));
    } finally {
      setUploadingKey(null);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await preOnboardingApi.submit(token);
      setData(res.data);
    } catch (error) {
      if (isNotFound(error)) setNotFound(true);
      else setSubmitError(apiErrorMessage(error, 'Could not submit. Please make sure every required document is uploaded.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p className="text-center text-sm text-warm-500">Loading…</p>;
  }
  if (notFound) {
    return (
      <div className="rounded-xl border border-warm-200 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-warm-900">{NOT_FOUND_MESSAGE}</h1>
        <p className="mt-2 text-sm text-warm-600">
          Please contact the company&apos;s HR team if you think this is a mistake.
        </p>
      </div>
    );
  }
  if (loadError || !data) {
    return (
      <div className="rounded-xl border border-warm-200 bg-white p-8 text-center">
        <p className="text-sm text-red-600">We could not load this page right now.</p>
        <button type="button" onClick={load} className="btn btn-secondary btn-sm mt-3">
          Try again
        </button>
      </div>
    );
  }

  const requiredMissing = data.documents.filter((d) => d.required && !d.uploaded);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        {data.company.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.company.logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-12 w-12 rounded object-contain"
          />
        )}
        <div>
          <p className="text-sm text-warm-500">{data.company.name}</p>
          <h1 className="text-2xl font-semibold text-warm-900">Welcome, {data.employeeFirstName}!</h1>
          <p className="text-sm text-warm-500">Joining on {formatDay(data.joinDate)}</p>
        </div>
      </header>

      {data.status === 'SUBMITTED' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800" role="status">
          Thanks — your details and documents have been submitted. HR will review them before your start date.
        </div>
      )}
      {data.status === 'COMPLETED' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800" role="status">
          Your pre-onboarding is complete. See you soon!
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-warm-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-warm-900">Your details</h2>
        <form onSubmit={saveDetails} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {DETAIL_FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={field.key} className="label">
                {field.label}
              </label>
              <input
                id={field.key}
                type={field.type ?? 'text'}
                className="input"
                disabled={locked}
                value={form[field.key] ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            {detailsError && (
              <p className="text-sm text-red-600" role="alert">
                {detailsError}
              </p>
            )}
            {detailsSaved && !detailsError && <p className="text-sm text-emerald-600">Details saved</p>}
            <button type="submit" className="btn btn-primary btn-md mt-2" disabled={locked || savingDetails}>
              {savingDetails ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4 rounded-xl border border-warm-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-warm-900">Documents</h2>
        <ul className="space-y-3">
          {data.documents.map((doc) => (
            <li key={doc.key} className="flex flex-col gap-2 rounded-lg border border-warm-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-warm-900">
                  {doc.label}
                  {doc.required && <span className="ml-1 text-primary-500">*</span>}
                </p>
                {doc.uploaded ? (
                  <p className="text-sm text-emerald-700">Uploaded: {doc.fileName}</p>
                ) : (
                  <p className="text-sm text-warm-500">Not uploaded yet</p>
                )}
                {uploadErrors[doc.key] && (
                  <p className="text-sm text-red-600" role="alert">
                    {uploadErrors[doc.key]}
                  </p>
                )}
              </div>
              {!locked && (
                <label className="btn btn-secondary btn-sm cursor-pointer">
                  {uploadingKey === doc.key ? 'Uploading…' : doc.uploaded ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                    disabled={uploadingKey === doc.key}
                    onChange={(e) => uploadDocument(doc, e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
      </section>

      {!locked && (
        <section className="rounded-xl border border-warm-200 bg-white p-6">
          {requiredMissing.length > 0 && (
            <p className="mb-3 text-sm text-warm-500">
              Still needed: {requiredMissing.map((d) => d.label).join(', ')}
            </p>
          )}
          {submitError && (
            <p className="mb-3 text-sm text-red-600" role="alert">
              {submitError}
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-md"
            disabled={submitting || requiredMissing.length > 0}
            onClick={submit}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </section>
      )}
    </div>
  );
}
