'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { surveysApi, type CreateSurveyPayload, type MySurvey, type Survey } from '@/lib/api-surveys';
import { SurveyBuilder } from '@/components/engagement/surveys/SurveyBuilder';
import toast from 'react-hot-toast';

type Tab = 'mine' | 'manage';

export default function SurveysPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN);
  const [tab, setTab] = useState<Tab>('mine');

  const [mySurveys, setMySurveys] = useState<MySurvey[]>([]);
  const [loadingMine, setLoadingMine] = useState(true);

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loadingManage, setLoadingManage] = useState(false);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Survey | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const loadMine = useCallback(async () => {
    setLoadingMine(true);
    try {
      const res = await surveysApi.mine();
      setMySurveys(res.data ?? []);
    } catch {
      toast.error('Failed to load your surveys');
    } finally {
      setLoadingMine(false);
    }
  }, []);

  const loadManage = useCallback(async () => {
    setLoadingManage(true);
    try {
      const res = await surveysApi.list();
      setSurveys(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load surveys');
    } finally {
      setLoadingManage(false);
    }
  }, []);

  useEffect(() => {
    loadMine();
  }, [loadMine]);

  useEffect(() => {
    if (tab === 'manage' && canManage) loadManage();
  }, [tab, canManage, loadManage]);

  const openCreate = () => {
    setEditing(undefined);
    setBuilderOpen(true);
  };

  const openEdit = (survey: Survey) => {
    setEditing(survey);
    setBuilderOpen(true);
  };

  const handleSave = async (payload: CreateSurveyPayload) => {
    setSaving(true);
    try {
      if (editing) {
        await surveysApi.update(editing.id, payload);
      } else {
        await surveysApi.create(payload);
      }
      toast.success('Survey saved');
      setBuilderOpen(false);
      loadManage();
    } catch {
      toast.error('Failed to save survey');
    } finally {
      setSaving(false);
    }
  };

  const handleLaunch = async (id: string) => {
    try {
      await surveysApi.launch(id);
      toast.success('Survey launched');
      loadManage();
    } catch {
      toast.error('Failed to launch survey');
    }
  };

  const handleClose = async (id: string) => {
    try {
      await surveysApi.close(id);
      toast.success('Survey closed');
      loadManage();
    } catch {
      toast.error('Failed to close survey');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await surveysApi.remove(id);
      toast.success('Draft deleted');
      loadManage();
    } catch {
      toast.error('Failed to delete draft');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pulse surveys</h1>
        {tab === 'manage' && canManage && (
          <Button onClick={openCreate}>New survey</Button>
        )}
      </div>

      <div className="flex gap-2 border-b">
        <button
          className={`px-3 py-2 text-sm font-medium ${tab === 'mine' ? 'border-b-2 border-primary-500 text-primary-600' : 'text-warm-500'}`}
          onClick={() => setTab('mine')}
        >
          My surveys
        </button>
        {canManage && (
          <button
            className={`px-3 py-2 text-sm font-medium ${tab === 'manage' ? 'border-b-2 border-primary-500 text-primary-600' : 'text-warm-500'}`}
            onClick={() => setTab('manage')}
          >
            Manage
          </button>
        )}
      </div>

      {tab === 'mine' && (
        <div className="space-y-3">
          {loadingMine && <p className="text-sm text-warm-400">Loading...</p>}
          {!loadingMine && mySurveys.length === 0 && (
            <p className="text-sm text-warm-400">No surveys yet.</p>
          )}
          {mySurveys.map((survey) => (
            <Card key={survey.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{survey.title}</p>
                  <p className="text-sm text-warm-500">{survey.questionCount} questions</p>
                </div>
                <div className="flex items-center gap-2">
                  {survey.submitted ? (
                    <Badge variant="success">Responded</Badge>
                  ) : survey.isOpen ? (
                    <Link href={`/engagement/surveys/${survey.id}`}>
                      <Button size="sm">Respond</Button>
                    </Link>
                  ) : (
                    <Badge variant="gray">Closed</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === 'manage' && canManage && (
        <div className="space-y-3">
          {loadingManage && <p className="text-sm text-warm-400">Loading...</p>}
          {!loadingManage && surveys.length === 0 && (
            <p className="text-sm text-warm-400">No surveys yet.</p>
          )}
          {surveys.map((survey) => (
            <Card key={survey.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{survey.title}</p>
                  <Badge variant="gray">{survey.status}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  {survey.status === 'DRAFT' && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(survey)}>
                        Edit
                      </Button>
                      <Button size="sm" onClick={() => handleLaunch(survey.id)}>
                        Launch
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => handleDelete(survey.id)}>
                        Delete
                      </Button>
                    </>
                  )}
                  {survey.status === 'ACTIVE' && (
                    <Button size="sm" variant="secondary" onClick={() => handleClose(survey.id)}>
                      Close
                    </Button>
                  )}
                  <Link href={`/engagement/surveys/${survey.id}/results`}>
                    <Button size="sm" variant="secondary">
                      Results
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={builderOpen} onClose={() => setBuilderOpen(false)} title={editing ? 'Edit survey' : 'New survey'} size="xl">
        <SurveyBuilder
          initial={editing}
          saving={saving}
          onSubmit={handleSave}
          onCancel={() => setBuilderOpen(false)}
        />
      </Modal>
    </div>
  );
}
