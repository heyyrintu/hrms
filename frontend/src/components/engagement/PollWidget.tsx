'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { pollsApi, type Poll, type RecentClosedPoll } from '@/lib/api-polls';
import toast from 'react-hot-toast';

const MAX_POLLS = 3;
const PENDING_VOTES_MESSAGE = 'Some votes are still being counted';

function PollCard({ poll, onVoted }: { poll: Poll; onVoted: (updated: Poll) => void }) {
  const [selected, setSelected] = useState<string>('');
  const [voting, setVoting] = useState(false);

  const handleVote = async () => {
    if (!selected) return;
    setVoting(true);
    try {
      await pollsApi.vote(poll.id, selected);
      const res = await pollsApi.active();
      const updated = res.data.find((p) => p.id === poll.id);
      if (updated) onVoted(updated);
      else onVoted({ ...poll, hasVoted: true });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to submit your vote');
    } finally {
      setVoting(false);
    }
  };

  const totalVotes = poll.totalVotes ?? 0;

  return (
    <div className="border-b border-warm-100 last:border-0 pb-4 last:pb-0 mb-4 last:mb-0">
      <p className="font-medium text-warm-900 mb-2">{poll.question}</p>

      {poll.hasVoted ? (
        <div className="space-y-1.5">
          {poll.options.map((option) => {
            const count = option.voteCount ?? 0;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            return (
              <div key={option.id}>
                <div className="flex justify-between text-xs text-warm-500">
                  <span>{option.label}</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-warm-100 overflow-hidden">
                  <div className="h-full bg-primary-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {(poll.pendingVotes ?? 0) > 0 && (
            <p className="text-xs text-warm-400">{PENDING_VOTES_MESSAGE}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {poll.options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm text-warm-700">
              <input
                type="radio"
                name={`poll-${poll.id}`}
                value={option.id}
                checked={selected === option.id}
                onChange={() => setSelected(option.id)}
              />
              {option.label}
            </label>
          ))}
          <Button
            type="button"
            className="h-8 px-3 text-sm"
            disabled={!selected}
            loading={voting}
            onClick={handleVote}
          >
            Vote
          </Button>
        </div>
      )}
    </div>
  );
}

function RecentResults({ polls }: { polls: RecentClosedPoll[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 pt-4 border-t border-warm-100">
      <button
        type="button"
        className="flex w-full items-center justify-between text-sm font-medium text-warm-700"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Recent results</span>
        <span className="text-xs text-warm-400">{open ? 'Hide' : `Show (${polls.length})`}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {polls.map((poll) => (
            <div key={poll.id}>
              <p className="font-medium text-warm-900 mb-2">{poll.question}</p>
              <div className="space-y-1.5">
                {poll.options.map((option) => {
                  const pct =
                    poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0;
                  return (
                    <div key={option.id}>
                      <div className="flex justify-between text-xs text-warm-500">
                        <span>{option.label}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-warm-100 overflow-hidden">
                        <div className="h-full bg-primary-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {poll.pendingVotes > 0 && (
                  <p className="text-xs text-warm-400">{PENDING_VOTES_MESSAGE}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Up to 3 active polls, plus a collapsible "Recent results" section for polls
 * that closed in the last 30 days. Renders nothing when there is neither.
 */
export function PollWidget() {
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [recent, setRecent] = useState<RecentClosedPoll[]>([]);

  useEffect(() => {
    pollsApi
      .active()
      .then((res) => setPolls(res.data.slice(0, MAX_POLLS)))
      .catch(() => setPolls([]));
    // Recent results are a bonus: a failure here must not hide the open polls.
    pollsApi
      .recentClosed()
      .then((res) => setRecent(res.data))
      .catch(() => setRecent([]));
  }, []);

  if (!polls || (polls.length === 0 && recent.length === 0)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Polls</CardTitle>
      </CardHeader>
      <CardContent>
        {polls.map((poll) => (
          <PollCard
            key={poll.id}
            poll={poll}
            onVoted={(updated) =>
              setPolls((prev) => (prev ? prev.map((p) => (p.id === updated.id ? updated : p)) : prev))
            }
          />
        ))}
        {recent.length > 0 && <RecentResults polls={recent} />}
      </CardContent>
    </Card>
  );
}
