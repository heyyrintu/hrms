'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { employeesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  RefreshCw,
  Network,
  ChevronDown,
  ChevronRight,
  User,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface OrgNode {
  id: string;
  name: string;
  employeeCode: string;
  designation: string;
  department: string;
  email: string;
  children: OrgNode[];
}

function OrgTreeNode({
  node,
  depth,
  searchQuery,
  expandedNodes,
  toggleExpand,
}: {
  node: OrgNode;
  depth: number;
  searchQuery: string;
  expandedNodes: Set<string>;
  toggleExpand: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  const matchesSearch =
    !searchQuery ||
    node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.employeeCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.designation.toLowerCase().includes(searchQuery.toLowerCase()) ||
    node.department.toLowerCase().includes(searchQuery.toLowerCase());

  const childMatchesSearch = (n: OrgNode): boolean => {
    if (
      n.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.employeeCode.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return true;
    return n.children.some(childMatchesSearch);
  };

  const shouldShow = !searchQuery || matchesSearch || childMatchesSearch(node);
  if (!shouldShow) return null;

  const highlight = searchQuery && matchesSearch;

  return (
    <div className={cn(depth > 0 && 'ml-6 border-l-2 border-warm-200 pl-4')}>
      <div
        className={cn(
          'flex items-start gap-3 py-2 px-3 rounded-lg transition-colors group',
          highlight ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-warm-50',
        )}
      >
        {/* Expand/Collapse */}
        <button
          onClick={() => hasChildren && toggleExpand(node.id)}
          className={cn(
            'mt-1 p-0.5 rounded transition-colors flex-shrink-0',
            hasChildren
              ? 'text-warm-400 hover:text-warm-600 hover:bg-warm-200 cursor-pointer'
              : 'text-transparent cursor-default',
          )}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )
          ) : (
            <User className="w-4 h-4 text-warm-300" />
          )}
        </button>

        {/* Avatar */}
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-100 to-primary-200 flex-shrink-0">
          <span className="text-primary-700 font-semibold text-sm">
            {node.name.charAt(0)}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-warm-900 text-sm">{node.name}</span>
            <span className="text-xs text-warm-400">{node.employeeCode}</span>
            {hasChildren && (
              <span className="text-xs bg-warm-100 text-warm-500 px-1.5 py-0.5 rounded-full">
                {node.children.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-warm-500 mt-0.5">
            {node.designation && <span>{node.designation}</span>}
            {node.designation && node.department && <span>·</span>}
            {node.department && <span>{node.department}</span>}
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="mt-1">
          {node.children.map((child) => (
            <OrgTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              searchQuery={searchQuery}
              expandedNodes={expandedNodes}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function countNodes(nodes: OrgNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

function collectAllIds(nodes: OrgNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...collectAllIds(n.children)]);
}

export default function OrgChartPage() {
  const [tree, setTree] = useState<OrgNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await employeesApi.getOrgChart();
      setTree(res.data);
      // Auto-expand top 2 levels
      const topIds = res.data.flatMap((root: OrgNode) => [
        root.id,
        ...root.children.map((c: OrgNode) => c.id),
      ]);
      setExpandedNodes(new Set(topIds));
    } catch (error) {
      console.error('Failed to load org chart:', error);
      toast.error('Failed to load org chart');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedNodes(new Set(collectAllIds(tree)));
  const collapseAll = () => setExpandedNodes(new Set());

  const totalEmployees = countNodes(tree);
  const topLevelCount = tree.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
            <Network className="w-7 h-7 text-primary-600" />
            Organization Chart
          </h1>
          <p className="text-warm-600 mt-1">
            {totalEmployees} employees · {topLevelCount} top-level
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={expandAll}>
            <ZoomIn className="w-4 h-4 mr-1" />
            Expand All
          </Button>
          <Button variant="secondary" size="sm" onClick={collapseAll}>
            <ZoomOut className="w-4 h-4 mr-1" />
            Collapse
          </Button>
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
        <input
          type="text"
          placeholder="Search by name, code, designation, or department..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (e.target.value) expandAll();
          }}
          className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
        />
      </div>

      {/* Tree */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : tree.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Network className="w-16 h-16 text-warm-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-warm-900 mb-2">No Employees Found</h3>
            <p className="text-warm-600">Add employees to see the organization chart.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-4">
            {tree.map((root) => (
              <OrgTreeNode
                key={root.id}
                node={root}
                depth={0}
                searchQuery={searchQuery}
                expandedNodes={expandedNodes}
                toggleExpand={toggleExpand}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
