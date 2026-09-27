'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { careersApi, type PublicCareers } from '@/lib/api-careers';
import { EMPLOYMENT_TYPE_LABELS, formatDay, formatExperience, isNotFound } from '@/components/recruitment/careers/careersFormat';

const NOT_FOUND_MESSAGE = 'Careers page not found';

/** Public careers page: `/careers/:tenantCode`. Lists only OPEN, public openings. */
export default function CareersPage() {
  const params = useParams<{ tenantCode: string }>();
  const tenantCode = (params?.tenantCode as string) ?? '';

  const [careers, setCareers] = useState<PublicCareers | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    try {
      const res = await careersApi.getCareers(tenantCode);
      setCareers(res.data);
    } catch (error) {
      if (isNotFound(error)) setNotFound(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [tenantCode]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <p className="text-center text-sm text-warm-500">Loading careers…</p>;
  }
  if (notFound) {
    return (
      <div className="rounded-xl border border-warm-200 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-warm-900">{NOT_FOUND_MESSAGE}</h1>
      </div>
    );
  }
  if (loadError || !careers) {
    return (
      <div className="rounded-xl border border-warm-200 bg-white p-8 text-center">
        <p className="text-sm text-red-600">We could not load this page right now.</p>
        <button type="button" onClick={load} className="btn btn-secondary btn-sm mt-3">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        {careers.company.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={careers.company.logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded object-contain"
          />
        )}
        <div>
          <h1 className="text-2xl font-semibold text-warm-900">{careers.company.name}</h1>
          {careers.company.website && (
            <a
              href={careers.company.website}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm text-primary-600 hover:underline"
            >
              {careers.company.website}
            </a>
          )}
        </div>
      </header>

      {careers.company.careersIntro && (
        <p className="whitespace-pre-wrap rounded-xl border border-warm-200 bg-white p-5 text-sm text-warm-700">
          {careers.company.careersIntro}
        </p>
      )}

      <section aria-label="Open positions" className="space-y-3">
        <h2 className="text-lg font-semibold text-warm-900">Open positions</h2>
        {careers.jobs.length === 0 ? (
          <p className="rounded-xl border border-warm-200 bg-white p-6 text-center text-sm text-warm-500">
            No open positions right now. Please check back later.
          </p>
        ) : (
          <ul className="space-y-3">
            {careers.jobs.map((job) => (
              <li key={job.slug}>
                <Link
                  href={`/careers/${tenantCode}/jobs/${job.slug}`}
                  className="block rounded-xl border border-warm-200 bg-white p-5 transition hover:border-primary-300 hover:shadow-sm"
                >
                  <h3 className="text-base font-semibold text-warm-900">{job.title}</h3>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-warm-500">
                    {job.department && <span>{job.department}</span>}
                    {job.location && <span>{job.location}</span>}
                    <span>{EMPLOYMENT_TYPE_LABELS[job.employmentType]}</span>
                    {formatExperience(job.experienceMin, job.experienceMax) && (
                      <span>{formatExperience(job.experienceMin, job.experienceMax)}</span>
                    )}
                  </p>
                  {job.publishedAt && (
                    <p className="mt-2 text-xs text-warm-400">Posted {formatDay(job.publishedAt)}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
