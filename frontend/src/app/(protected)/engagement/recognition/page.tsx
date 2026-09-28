'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import {
  recognitionApi,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type Recognition,
  type RecognitionSummary,
} from '@/lib/api-recognition';
import { GiveRecognitionModal } from '@/components/engagement/recognition/GiveRecognitionModal';
import { RecognitionCard } from '@/components/engagement/recognition/RecognitionCard';
import { LeaderboardTable } from '@/components/engagement/recognition/LeaderboardTable';
import { BadgeManager } from '@/components/engagement/recognition/BadgeManager';
import { EngagementSettingsForm } from '@/components/engagement/recognition/EngagementSettingsForm';
import { Award, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

type Tab = 'wall' | 'leaderboard' | 'badges' | 'settings';

export default function RecognitionPage() {
  const { hasRole, user } = useAuth();
  const isHr = hasRole(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN);
  const hasEmployee = !!user?.employeeId;

  const [tab, setTab] = useState<Tab>('wall');

  const [wall, setWall] = useState<Recognition[]>([]);
  const [summary, setSummary] = useState<RecognitionSummary | null>(null);
  const [meFailed, setMeFailed] = useState(false);
  const [wallLoading, setWallLoading] = useState(true);
  const [giveOpen, setGiveOpen] = useState(false);

  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // The wall is for everyone; `me()` 400s for a caller with no employee record
  // (e.g. SUPER_ADMIN). The two must not share a failure: losing `me()` should
  // never take the wall down with it.
  const loadWall = useCallback(async () => {
    setWallLoading(true);
    try {
      const wallRes = await recognitionApi.wall();
      setWall(wallRes.data?.data ?? []);
    } catch {
      toast.error('Failed to load the recognition wall');
    } finally {
      setWallLoading(false);
    }
  }, []);

  const loadMe = useCallback(async () => {
    if (!hasEmployee) {
      setMeFailed(true);
      return;
    }
    try {
      const meRes = await recognitionApi.me();
      setSummary(meRes.data ?? null);
      setMeFailed(false);
    } catch {
      setSummary(null);
      setMeFailed(true);
    }
  }, [hasEmployee]);

  const loadLeaderboard = useCallback(async (p: LeaderboardPeriod) => {
    setLeaderboardLoading(true);
    try {
      const res = await recognitionApi.leaderboard(p);
      setLeaderboard(res.data ?? []);
    } catch {
      toast.error('Failed to load the leaderboard');
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWall();
  }, [loadWall]);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (tab === 'leaderboard') {
      loadLeaderboard(period);
    }
  }, [tab, period, loadLeaderboard]);

  const handleGiven = async () => {
    await Promise.all([loadWall(), loadMe()]);
  };

  const deleteRecognition = async (id: string) => {
    try {
      await recognitionApi.remove(id);
      toast.success('Recognition deleted');
      await loadWall();
    } catch {
      toast.error('Failed to delete the recognition');
    }
  };

  // Giving requires an employee record; hide the entry point rather than let
  // the modal open onto a 400. A `me()` failure hides it too, out of caution,
  // even though the two only actually share the "no employee record" cause.
  const canGive = hasEmployee && !meFailed;

  const tabs: { id: Tab; label: string; visible: boolean }[] = [
    { id: 'wall', label: 'Wall', visible: true },
    { id: 'leaderboard', label: 'Leaderboard', visible: true },
    { id: 'badges', label: 'Badges', visible: isHr },
    { id: 'settings', label: 'Settings', visible: isHr },
  ];

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
              <Award className="h-6 w-6 text-primary-600" />
              Recognition
            </h1>
            <p className="mt-1 text-warm-600">Give kudos, track badges and see who&apos;s leading</p>
          </div>
          {tab === 'wall' && (
            <div className="flex gap-3">
              <Button variant="secondary" onClick={loadWall} disabled={wallLoading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', wallLoading && 'animate-spin')} />
                Refresh
              </Button>
              {canGive && (
                <Button onClick={() => setGiveOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Give Recognition
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-b border-warm-200" role="tablist" aria-label="Recognition sections">
          {tabs
            .filter((t) => t.visible)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'px-4 py-2 text-sm font-medium',
                  tab === t.id
                    ? 'border-b-2 border-primary-600 text-primary-700'
                    : 'text-warm-500 hover:text-warm-800',
                )}
              >
                {t.label}
              </button>
            ))}
        </div>

        {tab === 'wall' && (
          <div className="space-y-4">
            {summary?.pointsEnabled && (
              <Card>
                <CardContent className="flex flex-wrap gap-6 py-4 text-sm">
                  <span>
                    <span className="font-semibold text-warm-900">{summary.remainingThisMonth}</span>{' '}
                    points left this month
                  </span>
                  <span>
                    <span className="font-semibold text-warm-900">{summary.receivedPointsTotal}</span>{' '}
                    points received all-time
                  </span>
                </CardContent>
              </Card>
            )}

            {wallLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
              </div>
            ) : wall.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Award className="mx-auto mb-4 h-16 w-16 text-warm-300" />
                  <h3 className="mb-2 text-lg font-semibold text-warm-900">No recognitions yet</h3>
                  <p className="mb-4 text-warm-600">Be the first to give someone kudos.</p>
                  {canGive && (
                    <Button onClick={() => setGiveOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Give Recognition
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {wall.map((recognition) => (
                  <RecognitionCard
                    key={recognition.id}
                    recognition={recognition}
                    canDelete={isHr}
                    onDelete={deleteRecognition}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'leaderboard' && (
          <LeaderboardTable
            rows={leaderboard}
            period={period}
            onPeriodChange={setPeriod}
            pointsEnabled={!!summary?.pointsEnabled}
            loading={leaderboardLoading}
          />
        )}

        {tab === 'badges' && isHr && <BadgeManager />}

        {tab === 'settings' && isHr && <EngagementSettingsForm />}
      </div>

      <GiveRecognitionModal
        isOpen={giveOpen}
        onClose={() => setGiveOpen(false)}
        onGiven={handleGiven}
      />
    </>
  );
}
