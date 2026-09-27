'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';
import { surveysApi, type AnswerInput, type SurveyForm } from '@/lib/api-surveys';

const ANONYMITY_NOTICE =
  'This survey is anonymous. Your answers are not linked to you in the application or its data.';

export default function RespondToSurveyPage() {
  const params = useParams<{ id: string }>();
  const id = params.id as string;

  const [form, setForm] = useState<SurveyForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, AnswerInput>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await surveysApi.form(id);
      setForm(res.data);
      setSubmitted(res.data?.submitted ?? false);
    } catch {
      toast.error('Failed to load the survey');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const setAnswer = (questionId: string, patch: Partial<AnswerInput>) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { ...prev[questionId], ...patch, questionId },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await surveysApi.submit(id, { answers: Object.values(answers) });
      toast.success('Thanks for responding');
      setSubmitted(true);
    } catch {
      toast.error('Failed to submit your response');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-sm text-warm-400">Loading...</p>;
  if (!form) return <p className="text-sm text-warm-400">Survey not found.</p>;

  if (submitted) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p>Thanks, you have responded.</p>
        </CardContent>
      </Card>
    );
  }

  if (form.status !== 'ACTIVE' || (form.closesAt && new Date(form.closesAt) <= new Date())) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p>This survey is closed.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{form.title}</h1>
      {form.description && <p className="text-sm text-warm-600">{form.description}</p>}
      {form.isAnonymous && (
        <p className="text-sm text-warm-500" data-testid="anonymity-notice">
          {ANONYMITY_NOTICE}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {form.questions.map((q) => (
          <Card key={q.id}>
            <CardContent className="py-4 space-y-2">
              <p className="font-medium">
                {q.text}
                {q.required && <span className="text-primary-500 ml-1">*</span>}
              </p>

              {q.type === 'TEXT' && (
                <textarea
                  aria-label={q.text}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  onChange={(e) => setAnswer(q.id, { text: e.target.value })}
                />
              )}

              {q.type === 'SINGLE_CHOICE' &&
                q.options.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={q.id}
                      value={option}
                      onChange={() => setAnswer(q.id, { choices: [option] })}
                    />
                    {option}
                  </label>
                ))}

              {q.type === 'MULTI_CHOICE' &&
                q.options.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      value={option}
                      onChange={(e) => {
                        const current = answers[q.id]?.choices ?? [];
                        const next = e.target.checked
                          ? [...current, option]
                          : current.filter((c) => c !== option);
                        setAnswer(q.id, { choices: next });
                      }}
                    />
                    {option}
                  </label>
                ))}

              {q.type === 'RATING' && (
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      type="button"
                      key={v}
                      aria-label={`${q.text} rating ${v}`}
                      className={`h-9 w-9 rounded-full border text-sm ${answers[q.id]?.value === v ? 'bg-primary-500 text-white' : ''}`}
                      onClick={() => setAnswer(q.id, { value: v })}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}

              {q.type === 'ENPS' && (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 11 }, (_, v) => v).map((v) => (
                    <button
                      type="button"
                      key={v}
                      aria-label={`${q.text} score ${v}`}
                      className={`h-9 w-9 rounded-full border text-sm ${answers[q.id]?.value === v ? 'bg-primary-500 text-white' : ''}`}
                      onClick={() => setAnswer(q.id, { value: v })}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit'}
        </Button>
      </form>
    </div>
  );
}
