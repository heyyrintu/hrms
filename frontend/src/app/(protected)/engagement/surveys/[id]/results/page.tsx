'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import toast from 'react-hot-toast';
import {
  surveysApi,
  type NamedResponse,
  type QuestionResult,
  type SurveyResults,
} from '@/lib/api-surveys';

const WITHHELD_MESSAGE = 'Results are hidden until at least 3 people respond.';

export default function SurveyResultsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id as string;

  const [results, setResults] = useState<SurveyResults | null>(null);
  const [responses, setResponses] = useState<NamedResponse[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await surveysApi.results(id);
      setResults(res.data);
      if (res.data && !res.data.isAnonymous) {
        const named = await surveysApi.responses(id);
        setResponses(named.data ?? []);
      }
    } catch {
      toast.error('Failed to load results');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-warm-400">Loading...</p>;
  if (!results) return <p className="text-sm text-warm-400">Results not found.</p>;

  const pendingCount = results.pendingCount ?? 0;
  const submittedCount = results.responseCount + pendingCount;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-warm-500">Response rate</p>
          <p className="text-2xl font-semibold">
            {submittedCount} / {results.participantCount} ({results.responseRate}%)
          </p>
          {pendingCount > 0 && (
            <p className="mt-1 text-sm text-warm-500">
              {pendingCount} {pendingCount === 1 ? 'response is' : 'responses are'} waiting to be
              released in a batch.
            </p>
          )}
        </CardContent>
      </Card>

      {results.withheld ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p>{WITHHELD_MESSAGE}</p>
          </CardContent>
        </Card>
      ) : (
        (results.questions ?? []).map((q) => (
          <QuestionResultCard key={q.questionId} question={q} />
        ))
      )}

      {!results.isAnonymous && responses && (
        <Card>
          <CardHeader>
            <CardTitle>Named responses</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {responses.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      {r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'Unknown'}
                    </TableCell>
                    <TableCell>{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QuestionResultCard({ question }: { question: QuestionResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{question.text}</CardTitle>
      </CardHeader>
      <CardContent>
        {(question.type === 'SINGLE_CHOICE' || question.type === 'MULTI_CHOICE') && (
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={question.options}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="option" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {question.type === 'RATING' && (
          <div>
            <p className="text-lg font-semibold">
              {question.average ?? '–'} <span className="text-sm text-warm-400">average</span>
            </p>
            <div style={{ width: '100%', height: 180 }}>
              <ResponsiveContainer>
                <BarChart
                  data={[1, 2, 3, 4, 5].map((v) => ({ value: v, count: question.distribution[v] ?? 0 }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="value" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {question.type === 'ENPS' && (
          <div>
            <p className="text-3xl font-bold" data-testid="enps-score">
              {question.score ?? '–'}
            </p>
            <p className="text-sm text-warm-500">
              {question.promoters} promoters · {question.passives} passives · {question.detractors}{' '}
              detractors
            </p>
          </div>
        )}

        {question.type === 'TEXT' && (
          <ul className="space-y-1 text-sm">
            {question.answers.length === 0 && <li className="text-warm-400">No responses</li>}
            {question.answers.map((a, i) => (
              <li key={i} className="border-b pb-1">
                {a}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
