'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { careersApi, type CareersApplicationFields, type PublicJob } from '@/lib/api-careers';
import {
  EMPLOYMENT_TYPE_LABELS,
  apiErrorMessage,
  formatDay,
  formatExperience,
  formatInr,
  isNotFound,
} from '@/components/recruitment/careers/careersFormat';

const NOT_FOUND_MESSAGE = 'Careers page not found';
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const RESUME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  currentCompany: string;
  currentTitle: string;
  totalExperienceYears: string;
  linkedinUrl: string;
  coverLetter: string;
  /** Honeypot: hidden from sighted users, visible to bots that fill everything. */
  website: string;
};

const emptyForm: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  currentCompany: '',
  currentTitle: '',
  totalExperienceYears: '',
  linkedinUrl: '',
  coverLetter: '',
  website: '',
};

/** Public job page + apply form: `/careers/:tenantCode/jobs/:slug`. */
export default function CareersJobPage() {
  const params = useParams<{ tenantCode: string; slug: string }>();
  const tenantCode = (params?.tenantCode as string) ?? '';
  const slug = (params?.slug as string) ?? '';

  const [job, setJob] = useState<PublicJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [resume, setResume] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    try {
      const res = await careersApi.getJob(tenantCode, slug);
      setJob(res.data);
    } catch (error) {
      if (isNotFound(error)) setNotFound(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tenantCode, slug]);

  useEffect(() => {
    load();
  }, [load]);

  const onFileChange = (file: File | null) => {
    setFileError(null);
    if (!file) {
      setResume(null);
      return;
    }
    if (file.size > MAX_RESUME_BYTES) {
      setFileError('Resume must be 5 MB or smaller');
      setResume(null);
      return;
    }
    if (!RESUME_TYPES.includes(file.type)) {
      setFileError('Resume must be a PDF, DOC or DOCX file');
      setResume(null);
      return;
    }
    setResume(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resume) {
      setFileError('Please attach your resume');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const fields: CareersApplicationFields = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        currentCompany: form.currentCompany.trim() || undefined,
        currentTitle: form.currentTitle.trim() || undefined,
        totalExperienceYears: form.totalExperienceYears.trim() ? Number(form.totalExperienceYears) : undefined,
        linkedinUrl: form.linkedinUrl.trim() || undefined,
        coverLetter: form.coverLetter.trim() || undefined,
        website: form.website,
      };
      await careersApi.apply(tenantCode, slug, fields, resume);
      setApplied(true);
    } catch (error) {
      if (isNotFound(error)) setNotFound(true);
      else setSubmitError(apiErrorMessage(error, 'Could not submit your application. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p className="text-center text-sm text-warm-500">Loading job…</p>;
  }
  if (notFound) {
    return (
      <div className="rounded-xl border border-warm-200 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-warm-900">{NOT_FOUND_MESSAGE}</h1>
      </div>
    );
  }
  if (loadError || !job) {
    return (
      <div className="rounded-xl border border-warm-200 bg-white p-8 text-center">
        <p className="text-sm text-red-600">We could not load this job right now.</p>
        <button type="button" onClick={load} className="btn btn-secondary btn-sm mt-3">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        {job.company.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={job.company.logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-12 w-12 rounded object-contain"
          />
        )}
        <div>
          <p className="text-sm text-warm-500">{job.company.name}</p>
          <h1 className="text-2xl font-semibold text-warm-900">{job.title}</h1>
        </div>
      </header>

      <section className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-warm-200 bg-white p-5 text-sm text-warm-600">
        {job.location && <span>{job.location}</span>}
        {job.department && <span>{job.department}</span>}
        <span>{EMPLOYMENT_TYPE_LABELS[job.employmentType]}</span>
        {formatExperience(job.experienceMin, job.experienceMax) && (
          <span>{formatExperience(job.experienceMin, job.experienceMax)}</span>
        )}
        {(job.salaryMin != null || job.salaryMax != null) && (
          <span>
            {job.salaryMin != null ? formatInr(job.salaryMin) : ''}
            {job.salaryMin != null && job.salaryMax != null ? ' – ' : ''}
            {job.salaryMax != null ? formatInr(job.salaryMax) : ''}
          </span>
        )}
        {job.publishedAt && <span>Posted {formatDay(job.publishedAt)}</span>}
      </section>

      <article className="whitespace-pre-wrap rounded-xl border border-warm-200 bg-white p-6 text-sm leading-relaxed text-warm-800">
        {job.description}
        {job.requirements && (
          <>
            <h2 className="mt-4 text-base font-semibold text-warm-900">Requirements</h2>
            {job.requirements}
          </>
        )}
      </article>

      {applied ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800" role="status">
          <h2 className="text-lg font-semibold">Application received</h2>
          <p className="mt-1 text-sm">Thank you for applying — we&apos;ll be in touch if there&apos;s a fit.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-warm-200 bg-white p-6" noValidate>
          <h2 className="text-lg font-semibold text-warm-900">Apply for this role</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className="label">
                First name
              </label>
              <input
                id="firstName"
                className="input"
                required
                maxLength={100}
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="lastName" className="label">
                Last name
              </label>
              <input
                id="lastName"
                className="input"
                required
                maxLength={100}
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="email" className="label">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="input"
                required
                maxLength={255}
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="phone" className="label">
                Phone (optional)
              </label>
              <input id="phone" className="input" maxLength={30} value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label htmlFor="currentCompany" className="label">
                Current company (optional)
              </label>
              <input
                id="currentCompany"
                className="input"
                maxLength={150}
                value={form.currentCompany}
                onChange={(e) => set('currentCompany', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="currentTitle" className="label">
                Current title (optional)
              </label>
              <input
                id="currentTitle"
                className="input"
                maxLength={150}
                value={form.currentTitle}
                onChange={(e) => set('currentTitle', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="totalExperienceYears" className="label">
                Years of experience (optional)
              </label>
              <input
                id="totalExperienceYears"
                type="number"
                min={0}
                max={60}
                className="input"
                value={form.totalExperienceYears}
                onChange={(e) => set('totalExperienceYears', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="linkedinUrl" className="label">
                LinkedIn URL (optional)
              </label>
              <input
                id="linkedinUrl"
                type="url"
                className="input"
                maxLength={300}
                value={form.linkedinUrl}
                onChange={(e) => set('linkedinUrl', e.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="coverLetter" className="label">
              Cover letter (optional)
            </label>
            <textarea
              id="coverLetter"
              className="input min-h-[96px]"
              maxLength={5000}
              value={form.coverLetter}
              onChange={(e) => set('coverLetter', e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="resume" className="label">
              Resume (PDF, DOC or DOCX, up to 5 MB)
            </label>
            <input
              id="resume"
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="input"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
            {fileError && (
              <p className="mt-1 text-sm text-red-600" role="alert">
                {fileError}
              </p>
            )}
          </div>

          {/* Honeypot: hidden from sighted users via CSS, left in the DOM for bots. */}
          <div className="absolute -left-[9999px]" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(e) => set('website', e.target.value)}
            />
          </div>

          {submitError && (
            <p className="text-sm text-red-600" role="alert">
              {submitError}
            </p>
          )}

          <button type="submit" className="btn btn-primary btn-md" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </form>
      )}
    </div>
  );
}
