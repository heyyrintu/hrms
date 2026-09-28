'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { pollsApi, type Poll } from '@/lib/api-polls';
import toast from 'react-hot-toast';

const MAX_POLLS = 3;

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

/** Up to 3 active polls, shown on the dashboard. Renders nothing when there are none. */
export function PollWidget() {
  const [polls, setPolls] = useState<Poll[] | null>(null);

  useEffect(() => {
    pollsApi
      .active()
      .then((res) => setPolls(res.data.slice(0, MAX_POLLS)))
      .catch(() => setPolls([]));
  }, []);

  if (!polls || polls.length === 0) return null;

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
      </CardContent>
    </Card>
  );
}
