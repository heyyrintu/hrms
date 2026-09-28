'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { FormRow, FormGrid } from '@/components/ui/FormRow';
import { departmentsApi, branchesApi } from '@/lib/api';
import { Plus, Trash2 } from 'lucide-react';
import type {
  CreateSurveyPayload,
  EngagementAudience,
  Survey,
  SurveyQuestionInput,
  SurveyQuestionType,
} from '@/lib/api-surveys';

const QUESTION_TYPES: { value: SurveyQuestionType; label: string }[] = [
  { value: 'TEXT', label: 'Text' },
  { value: 'SINGLE_CHOICE', label: 'Single choice' },
  { value: 'MULTI_CHOICE', label: 'Multiple choice' },
  { value: 'RATING', label: 'Rating (1-5)' },
  { value: 'ENPS', label: 'eNPS (0-10)' },
];

const emptyQuestion = (): SurveyQuestionInput => ({
  type: 'TEXT',
  text: '',
  required: true,
  options: [],
});

interface Option {
  id: string;
  name: string;
}

interface SurveyBuilderProps {
  initial?: Survey;
  onSubmit: (payload: CreateSurveyPayload) => Promise<void> | void;
  onCancel: () => void;
  saving?: boolean;
}

export function SurveyBuilder({ initial, onSubmit, onCancel, saving }: SurveyBuilderProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isAnonymous, setIsAnonymous] = useState(initial?.isAnonymous ?? false);
  const [audienceType, setAudienceType] = useState<EngagementAudience>(
    initial?.audienceType ?? 'ALL',
  );
  const [audienceIds, setAudienceIds] = useState<string[]>(initial?.audienceIds ?? []);
  const [closesAt, setClosesAt] = useState(initial?.closesAt?.slice(0, 10) ?? '');
  const [questions, setQuestions] = useState<SurveyQuestionInput[]>(
    initial?.questions?.map((q) => ({
      type: q.type,
      text: q.text,
      required: q.required,
      options: q.options,
    })) ?? [emptyQuestion()],
  );

  const [departments, setDepartments] = useState<Option[]>([]);
  const [branches, setBranches] = useState<Option[]>([]);

  useEffect(() => {
    departmentsApi.getAll().then((res) => setDepartments(res.data ?? [])).catch(() => undefined);
    branchesApi.getAll().then((res) => setBranches(res.data ?? [])).catch(() => undefined);
  }, []);

  const audienceOptions = audienceType === 'DEPARTMENT' ? departments : branches;

  const updateQuestion = (index: number, patch: Partial<SurveyQuestionInput>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const addQuestion = () => setQuestions((prev) => [...prev, emptyQuestion()]);
  const removeQuestion = (index: number) =>
    setQuestions((prev) => prev.filter((_, i) => i !== index));

  const addOption = (index: number) =>
    updateQuestion(index, { options: [...(questions[index].options ?? []), ''] });
  const updateOption = (index: number, optIndex: number, value: string) => {
    const options = [...(questions[index].options ?? [])];
    options[optIndex] = value;
    updateQuestion(index, { options });
  };
  const removeOption = (index: number, optIndex: number) => {
    const options = (questions[index].options ?? []).filter((_, i) => i !== optIndex);
    updateQuestion(index, { options });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CreateSurveyPayload = {
      title,
      description: description || undefined,
      isAnonymous,
      audienceType,
      audienceIds: audienceType === 'ALL' ? [] : audienceIds,
      // A date-only pick means "through the end of that day" in IST, not UTC
      // midnight (which is 05:30 IST on the chosen day).
      closesAt: closesAt ? `${closesAt}T23:59:59+05:30` : undefined,
      questions,
    };
    await onSubmit(payload);
  };

  const isChoice = (type: SurveyQuestionType) => type === 'SINGLE_CHOICE' || type === 'MULTI_CHOICE';

  return (
    <form onSubmit={handleSubmit} data-testid="survey-builder-form">
      <FormGrid cols={2}>
        <FormRow colSpan={2}>
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
        </FormRow>
        <FormRow colSpan={2}>
          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </FormRow>
        <FormRow label="Audience">
          <Select
            aria-label="Audience"
            value={audienceType}
            onChange={(e) => {
              setAudienceType(e.target.value as EngagementAudience);
              setAudienceIds([]);
            }}
            options={[
              { value: 'ALL', label: 'Everyone' },
              { value: 'DEPARTMENT', label: 'Department' },
              { value: 'BRANCH', label: 'Branch' },
            ]}
          />
        </FormRow>
        {audienceType !== 'ALL' && (
          <FormRow label={audienceType === 'DEPARTMENT' ? 'Departments' : 'Branches'}>
            <select
              aria-label="Audience targets"
              multiple
              value={audienceIds}
              onChange={(e) =>
                setAudienceIds(Array.from(e.target.selectedOptions).map((o) => o.value))
              }
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              {audienceOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </FormRow>
        )}
        <FormRow label="Closes at">
          <Input type="date" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </FormRow>
        <FormRow label="Anonymous">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="Anonymous"
              checked={isAnonymous}
              disabled={!!initial}
              onChange={(e) => setIsAnonymous(e.target.checked)}
            />
            Responses are not linked to the respondent
          </label>
        </FormRow>
      </FormGrid>

      <div className="mt-4 space-y-4">
        <h3 className="text-sm font-semibold text-warm-700">Questions</h3>
        {questions.map((q, index) => (
          <div key={index} className="rounded-lg border p-3" data-testid={`question-${index}`}>
            <FormGrid cols={2}>
              <FormRow label="Type">
                <Select
                  aria-label={`Question ${index + 1} type`}
                  value={q.type}
                  onChange={(e) =>
                    updateQuestion(index, {
                      type: e.target.value as SurveyQuestionType,
                      options: isChoice(e.target.value as SurveyQuestionType) ? ['', ''] : [],
                    })
                  }
                  options={QUESTION_TYPES}
                />
              </FormRow>
              <FormRow label="Required">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Question ${index + 1} required`}
                    checked={q.required ?? true}
                    onChange={(e) => updateQuestion(index, { required: e.target.checked })}
                  />
                  Required
                </label>
              </FormRow>
              <FormRow label="Question text" colSpan={2}>
                <Input
                  aria-label={`Question ${index + 1} text`}
                  value={q.text}
                  onChange={(e) => updateQuestion(index, { text: e.target.value })}
                  required
                  maxLength={500}
                />
              </FormRow>
            </FormGrid>

            {isChoice(q.type) && (
              <div className="mt-2 space-y-2">
                {(q.options ?? []).map((option, optIndex) => (
                  <div key={optIndex} className="flex items-center gap-2">
                    <Input
                      aria-label={`Question ${index + 1} option ${optIndex + 1}`}
                      value={option}
                      onChange={(e) => updateOption(index, optIndex, e.target.value)}
                    />
                    <button
                      type="button"
                      aria-label={`Remove option ${optIndex + 1}`}
                      onClick={() => removeOption(index, optIndex)}
                    >
                      <Trash2 className="h-4 w-4 text-warm-500" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="secondary" onClick={() => addOption(index)}>
                  <Plus className="h-4 w-4 mr-1" /> Add option
                </Button>
              </div>
            )}

            <div className="mt-2">
              <button
                type="button"
                aria-label={`Remove question ${index + 1}`}
                onClick={() => removeQuestion(index)}
                disabled={questions.length === 1}
                className="text-sm text-red-600 disabled:opacity-50"
              >
                Remove question
              </button>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={addQuestion}>
          <Plus className="h-4 w-4 mr-1" /> Add question
        </Button>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save draft'}
        </Button>
      </div>
    </form>
  );
}
