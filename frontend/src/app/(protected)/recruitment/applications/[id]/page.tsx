'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/contexts/AuthContext';
import { currentEmployeeId } from '@/lib/current-employee';
import { UserRole } from '@/types';
import { recruitmentApi, type ApplicationDetail, type JobApplicationStatus } from '@/lib/api-recruitment';
import { InterviewPanel } from '@/components/recruitment/interviews/InterviewPanel';
import { OfferPanel } from '@/components/recruitment/offers/OfferPanel';
import { formatDateTime, formatInr } from '@/components/recruitment/offers/offerFormat';

const STATUS_VARIANT: Record<JobApplicationStatus, 'info' | 'success' | 'danger' | 'gray'> = {
  ACTIVE: 'info',
  HIRED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'gray',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-warm-500">{label}</dt>
      <dd className="text-sm text-warm-900">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * One application: candidate, stage history, interviews (HR or the opening's
 * hiring manager) and offers (HR only). The API enforces every rule; the UI
 * only hides what the viewer cannot use.
 */
export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params?.id as string;
  const { user, hasRole } = useAuth();
  const myEmployeeId = currentEmployeeId(user);
  const isHr = hasRole(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN);
  const allowed = hasRole(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER);

  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!applicationId || !allowed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await recruitmentApi.getApplication(applicationId);
      setApplication(res.data);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(status === 404 ? 'Application not found' : status === 403 ? 'You cannot view this application' : 'Failed to load the application');
      if (status !== 404 && status !== 403) toast.error('Failed to load the application');
    } finally {
      setLoading(false);
    }
  }, [applicationId, allowed]);

  useEffect(() => {
    load();
  }, [load]);

  if (!allowed) {
    return <p className="p-6 text-sm text-warm-600">You do not have access to recruitment.</p>;
  }
  if (loading && !application) {
    return <p className="p-6 text-sm text-warm-500">Loading application…</p>;
  }
  if (error || !application) {
    return (
      <div className="space-y-3 p-6">
        <p className="text-sm text-red-600">{error ?? 'Application not found'}</p>
        <Button size="sm" variant="secondary" onClick={load}>
          <RefreshCw className="mr-1 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  const { candidate } = application;
  const active = application.status === 'ACTIVE';
  const canManageInterviews =
    isHr ||
    (!!myEmployeeId && myEmployeeId === application.jobOpening.hiringManagerId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href={`/recruitment/openings/${application.jobOpening.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> {application.jobOpening.title}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-warm-900">
            {candidate.firstName} {candidate.lastName}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="default">{application.stage.name}</Badge>
          <Badge variant={STATUS_VARIANT[application.status]}>{application.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <InterviewPanel
            applicationId={application.id}
            applicationActive={active}
            canManage={canManageInterviews}
          />
          {isHr && <OfferPanel applicationId={application.id} applicationActive={active} onChanged={load} />}
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-base font-semibold text-warm-900">Candidate</h2>
              <dl className="grid grid-cols-1 gap-3">
                <Field label="E-mail" value={candidate.email} />
                <Field label="Phone" value={candidate.phone} />
                <Field
                  label="Current role"
                  value={
                    [candidate.currentTitle, candidate.currentCompany].filter(Boolean).join(' at ') || null
                  }
                />
                <Field
                  label="Experience"
                  value={candidate.totalExperienceYears != null ? `${candidate.totalExperienceYears} years` : null}
                />
                <Field label="Location" value={candidate.location} />
                <Field
                  label="Notice period"
                  value={candidate.noticePeriodDays != null ? `${candidate.noticePeriodDays} days` : null}
                />
                {isHr && (
                  <>
                    <Field label="Current CTC" value={candidate.currentCtc != null ? formatInr(candidate.currentCtc) : null} />
                    <Field label="Expected CTC" value={candidate.expectedCtc != null ? formatInr(candidate.expectedCtc) : null} />
                  </>
                )}
                <Field label="Source" value={application.source.replace(/_/g, ' ').toLowerCase()} />
                <Field label="Résumé" value={application.resumeFileName ?? candidate.resumeFileName} />
                {candidate.linkedinUrl && (
                  <Field
                    label="LinkedIn"
                    value={
                      <a
                        href={candidate.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="break-all text-primary-600 hover:underline"
                      >
                        {candidate.linkedinUrl}
                      </a>
                    }
                  />
                )}
              </dl>
              {application.coverLetter && (
                <div className="mt-4">
                  <p className="text-xs uppercase tracking-wide text-warm-500">Cover letter</p>
                  <p className="whitespace-pre-wrap text-sm text-warm-800">{application.coverLetter}</p>
                </div>
              )}
              {application.rejectionReason && (
                <p className="mt-4 text-sm text-red-600">Rejected: {application.rejectionReason}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-base font-semibold text-warm-900">Stage history</h2>
              {application.history.length === 0 ? (
                <p className="text-sm text-warm-500">No stage changes yet.</p>
              ) : (
                <ol className="space-y-2">
                  {application.history.map((event) => (
                    <li key={event.id} className="text-sm">
                      <span className="font-medium text-warm-800">
                        {event.fromStage ? `${event.fromStage.name} → ` : ''}
                        {event.toStage.name}
                      </span>
                      <span className="ml-2 text-warm-500">{formatDateTime(event.createdAt)}</span>
                      {event.movedBy && <span className="ml-1 text-warm-500">by {event.movedBy.name}</span>}
                      {event.note && <p className="text-warm-600">{event.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 text-xs text-warm-500">Applied {formatDateTime(application.appliedAt)}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
