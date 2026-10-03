'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Distribution } from '@/lib/api-performance-calibration';

export function distributionToData(d: Distribution) {
  return [
    { rating: '1', count: d['1'] },
    { rating: '2', count: d['2'] },
    { rating: '3', count: d['3'] },
    { rating: '4', count: d['4'] },
    { rating: '5', count: d['5'] },
    { rating: 'Unrated', count: d.unrated },
  ];
}

interface Props {
  title: string;
  distribution: Distribution;
}

export function DistributionChart({ title, distribution }: Props) {
  return (
    <div className="rounded-lg border border-warm-200 bg-white p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-sm font-semibold text-warm-800 truncate">{title}</h4>
        <span className="text-xs text-warm-500">{distribution.total} reviews</span>
      </div>
      <div style={{ width: '100%', height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={distributionToData(distribution)}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="rating" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={24} />
            <Tooltip />
            <Bar dataKey="count" fill="#4f46e5" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
