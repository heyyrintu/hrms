'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { auditApi } from '@/lib/api';
import { AuditLog, AuditAction } from '@/types';
import {
  Shield,
  RefreshCw,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';

const actionColors: Record<AuditAction, string> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  LOGIN: 'default',
};

const actionLabels: Record<AuditAction, string> = {
  CREATE: 'Create',
  UPDATE: 'Update',
  DELETE: 'Delete',
  LOGIN: 'Login',
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 25, totalPages: 0 });

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(meta.limit),
      };
      if (actionFilter) params.action = actionFilter;
      if (entityTypeFilter) params.entityType = entityTypeFilter;
      if (userIdFilter) params.userId = userIdFilter;
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;

      const res = await auditApi.getLogs(params);
      setLogs(res.data.data);
      setMeta(res.data.meta);
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  }, [actionFilter, entityTypeFilter, userIdFilter, fromDate, toDate, meta.limit]);

  useEffect(() => {
    fetchLogs(1);
  }, [fetchLogs]);

  const handleSearch = () => {
    fetchLogs(1);
  };

  const clearFilters = () => {
    setActionFilter('');
    setEntityTypeFilter('');
    setUserIdFilter('');
    setFromDate('');
    setToDate('');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const renderJsonDiff = (label: string, values?: Record<string, unknown>) => {
    if (!values || Object.keys(values).length === 0) return null;
    return (
      <div className="mt-2">
        <p className="text-xs font-medium text-warm-500 mb-1">{label}:</p>
        <pre className="text-xs bg-warm-50 p-2 rounded overflow-x-auto max-h-48">
          {JSON.stringify(values, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-warm-900">Audit Logs</h1>
            <p className="text-sm text-warm-500">
              Track all changes and activities across the system
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => fetchLogs(meta.page)}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div>
              <label className="block text-xs font-medium text-warm-700 mb-1">
                Action
              </label>
              <select
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="w-full rounded-md border border-warm-300 px-3 py-2 text-sm"
              >
                <option value="">All Actions</option>
                <option value="CREATE">Create</option>
                <option value="UPDATE">Update</option>
                <option value="DELETE">Delete</option>
                <option value="LOGIN">Login</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-warm-700 mb-1">
                Entity Type
              </label>
              <input
                type="text"
                placeholder="e.g. Employee"
                value={entityTypeFilter}
                onChange={(e) => setEntityTypeFilter(e.target.value)}
                className="w-full rounded-md border border-warm-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-warm-700 mb-1">
                User ID
              </label>
              <input
                type="text"
                placeholder="Filter by user"
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
                className="w-full rounded-md border border-warm-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-warm-700 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-md border border-warm-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-warm-700 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-md border border-warm-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button variant="primary" onClick={handleSearch} className="flex-1">
                <Search className="h-4 w-4 mr-1" />
                Search
              </Button>
              <Button variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-warm-500">
              <Shield className="h-12 w-12 mx-auto mb-3 text-warm-300" />
              <p className="text-lg font-medium">No audit logs found</p>
              <p className="text-sm">Try adjusting your filters</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-warm-50">
                      <th className="text-left px-4 py-3 font-medium text-warm-600 w-8"></th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">
                        Timestamp
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">
                        Action
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">
                        Entity
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">
                        Entity ID
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">
                        User ID
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-warm-600">
                        IP Address
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <>
                        <tr
                          key={log.id}
                          className="border-b hover:bg-warm-50 cursor-pointer"
                          onClick={() =>
                            setExpandedId(expandedId === log.id ? null : log.id)
                          }
                        >
                          <td className="px-4 py-3">
                            {expandedId === log.id ? (
                              <ChevronDown className="h-4 w-4 text-warm-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-warm-400" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-warm-600 whitespace-nowrap">
                            {formatDate(log.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant={
                                actionColors[log.action] as
                                  | 'success'
                                  | 'info'
                                  | 'danger'
                                  | 'default'
                              }
                            >
                              {actionLabels[log.action]}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 font-medium text-warm-900">
                            {log.entityType}
                          </td>
                          <td className="px-4 py-3 text-warm-600 font-mono text-xs">
                            {log.entityId
                              ? `${log.entityId.substring(0, 8)}...`
                              : '-'}
                          </td>
                          <td className="px-4 py-3 text-warm-600 font-mono text-xs">
                            {log.userId
                              ? `${log.userId.substring(0, 8)}...`
                              : '-'}
                          </td>
                          <td className="px-4 py-3 text-warm-600 text-xs">
                            {log.ipAddress || '-'}
                          </td>
                        </tr>
                        {expandedId === log.id && (
                          <tr key={`${log.id}-detail`} className="bg-warm-50">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <p className="text-xs text-warm-500">
                                    <strong>Full ID:</strong> {log.id}
                                  </p>
                                  <p className="text-xs text-warm-500 mt-1">
                                    <strong>User Agent:</strong>{' '}
                                    {log.userAgent || 'N/A'}
                                  </p>
                                  {log.entityId && (
                                    <p className="text-xs text-warm-500 mt-1">
                                      <strong>Full Entity ID:</strong>{' '}
                                      {log.entityId}
                                    </p>
                                  )}
                                  {log.userId && (
                                    <p className="text-xs text-warm-500 mt-1">
                                      <strong>Full User ID:</strong>{' '}
                                      {log.userId}
                                    </p>
                                  )}
                                </div>
                                <div>
                                  {renderJsonDiff('Old Values', log.oldValues)}
                                  {renderJsonDiff('New Values', log.newValues)}
                                  {!log.oldValues && !log.newValues && (
                                    <p className="text-xs text-warm-400 italic">
                                      No value changes recorded
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-sm text-warm-600">
                  Showing {(meta.page - 1) * meta.limit + 1} -{' '}
                  {Math.min(meta.page * meta.limit, meta.total)} of {meta.total}{' '}
                  entries
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => fetchLogs(meta.page - 1)}
                    disabled={meta.page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-warm-600">
                    Page {meta.page} of {meta.totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => fetchLogs(meta.page + 1)}
                    disabled={meta.page >= meta.totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
