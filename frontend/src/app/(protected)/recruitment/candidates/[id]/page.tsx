'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Mail, Phone, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StageBadge } from '@/components/recruitment/pipeline/StageBadge';
import { recruitmentApi, type CandidateDetail } from '@/lib/api-recruitment';

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recruitmentApi.getCandidate(id);
      setCandidate(res.data);
    } catch {
      toast.error('Failed to load candidate');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !candidate) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!candidate) return null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/recruitment/candidates" className="mb-1 flex items-center gap-1 text-sm text-warm-500 hover:text-warm-700">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to candidates
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
          <User className="h-6 w-6 text-primary-600" />
          {candidate.firstName} {candidate.lastName}
        </h1>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardContent className="space-y-3 py-5">
            <p className="flex items-center gap-2 text-sm text-warm-700">
              <Mail className="h-4 w-4 text-warm-400" /> {candidate.email}
            </p>
            {candidate.phone && (
              <p className="flex items-center gap-2 text-sm text-warm-700">
                <Phone className="h-4 w-4 text-warm-400" /> {candidate.phone}
              </p>
            )}
            {candidate.currentTitle && (
              <p className="text-sm text-warm-700">
                {candidate.currentTitle}
                {candidate.currentCompany ? ` at ${candidate.currentCompany}` : ''}
              </p>
            )}
            {candidate.totalExperienceYears != null && (
              <p className="text-sm text-warm-500">{candidate.totalExperienceYears} yrs experience</p>
            )}
            {candidate.currentCtc != null && (
              <p className="text-sm text-warm-500">
                Current CTC: ₹{candidate.currentCtc.toLocaleString('en-IN')}
              </p>
            )}
            {candidate.expectedCtc != null && (
              <p className="text-sm text-warm-500">
                Expected CTC: ₹{candidate.expectedCtc.toLocaleString('en-IN')}
              </p>
            )}
            {candidate.noticePeriodDays != null && (
              <p className="text-sm text-warm-500">Notice period: {candidate.noticePeriodDays} days</p>
            )}
            {candidate.location && <p className="text-sm text-warm-500">{candidate.location}</p>}
            {candidate.linkedinUrl && (
              <a
                href={candidate.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-sm text-primary-600 hover:underline"
              >
                LinkedIn profile
              </a>
            )}
            {candidate.resumeKey && (
              <a
                href={`/api/uploads/${candidate.resumeKey}`}
                target="_blank"
                rel="noreferrer"
                className="block text-sm text-primary-600 hover:underline"
              >
                {candidate.resumeFileName ?? 'Resume'}
              </a>
            )}
            <Badge variant="gray">{candidate.source.replace('_', ' ')}</Badge>
            {candidate.referredBy && (
              <p className="text-xs text-warm-400">
                Referred by {candidate.referredBy.firstName} {candidate.referredBy.lastName}
              </p>
            )}
            {candidate.notes && <p className="whitespace-pre-wrap text-sm text-warm-600">{candidate.notes}</p>}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardContent className="py-5">
            <h2 className="mb-3 text-sm font-semibold text-warm-700">Applications</h2>
            {candidate.applications.length === 0 ? (
              <p className="text-sm text-warm-500">This candidate has not applied to any opening yet.</p>
            ) : (
              <div className="space-y-2">
                {candidate.applications.map((app) => (
                  <Link
                    key={app.id}
                    href={`/recruitment/applications/${app.id}`}
                    className="flex items-center justify-between rounded-lg border border-warm-200 p-3 hover:bg-warm-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-warm-900">{app.jobOpening.title}</p>
                      <p className="text-xs text-warm-500">
                        Applied {new Date(app.appliedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <StageBadge name={app.stage.name} category={app.stage.category} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
