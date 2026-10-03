'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import type { GoalTreeNode } from '@/lib/api-performance-goals';
import { STATUS_LABEL, STATUS_VARIANT, ownerLabel } from './goal-utils';

interface GoalTreeProps {
  nodes: GoalTreeNode[];
  onSelect: (goalId: string) => void;
}

function TreeNode({ node, depth, onSelect }: { node: GoalTreeNode; depth: number; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  const progress = Math.max(0, Math.min(100, Math.round(node.progress)));

  return (
    <li>
      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border border-warm-200 bg-white px-3 py-2 mb-2"
        style={{ marginLeft: depth * 24 }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-warm-100 text-warm-500"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-6" />
        )}
        <Badge variant="default">{ownerLabel(node)}</Badge>
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="font-medium text-warm-900 hover:text-primary-600 text-left"
        >
          {node.title}
        </button>
        <Badge variant={STATUS_VARIANT[node.status]}>{STATUS_LABEL[node.status]}</Badge>
        {node.keyResults.length > 0 && (
          <span className="text-xs text-warm-500">
            {node.keyResults.length} {node.keyResults.length === 1 ? 'KR' : 'KRs'}
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto w-40">
          <div
            className="h-2 flex-1 rounded-full bg-warm-100 overflow-hidden"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-primary-500" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-warm-600 w-9 text-right">{progress}%</span>
        </div>
      </div>
      {hasChildren && expanded && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function GoalTree({ nodes, onSelect }: GoalTreeProps) {
  return (
    <ul>
      {nodes.map((n) => (
        <TreeNode key={n.id} node={n} depth={0} onSelect={onSelect} />
      ))}
    </ul>
  );
}
