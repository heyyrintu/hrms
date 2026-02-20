'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
  TableLoadingState,
} from '@/components/ui/Table';
import { documentsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  FileWarning,
  RefreshCw,
  Send,
  AlertTriangle,
  Clock,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface ExpiringDocument {
  id: string;
  name: string;
  category: string;
  expiryDate: string;
  employeeId: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    department: { name: string } | null;
  };
}

type Tab = 'expiring' | 'expired';

const DAYS_OPTIONS = [7, 14, 30, 60, 90];

function getDaysRemaining(expiryDate: string): number {
  const now = new Date();
  const expiry = new Date(expiryDate);
  const diffMs = expiry.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getDaysLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return 'Expires today';
  if (days === 1) return '1 day remaining';
  return `${days} days remaining`;
}

function getDaysBadgeVariant(days: number): 'danger' | 'warning' | 'success' {
  if (days < 7) return 'danger';
  if (days < 14) return 'warning';
  return 'success';
}

export default function DocumentExpiryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('expiring');
  const [expiringDocs, setExpiringDocs] = useState<ExpiringDocument[]>([]);
  const [expiredDocs, setExpiredDocs] = useState<ExpiringDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [daysFilter, setDaysFilter] = useState(30);

  useEffect(() => {
    loadData();
  }, [daysFilter]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [expiringRes, expiredRes] = await Promise.all([
        documentsApi.getExpiring(daysFilter),
        documentsApi.getExpired(),
      ]);
      setExpiringDocs(expiringRes.data);
      setExpiredDocs(expiredRes.data);
    } catch (error) {
      console.error('Failed to load document expiry data:', error);
      toast.error('Failed to load document expiry data');
    } finally {
      setLoading(false);
    }
  };

  const handleSendAlerts = async () => {
    setSending(true);
    try {
      const res = await documentsApi.sendExpiryAlerts(daysFilter);
      const { sentCount } = res.data;
      toast.success(`Sent ${sentCount} expiry alert${sentCount !== 1 ? 's' : ''} successfully`);
    } catch (error) {
      console.error('Failed to send expiry alerts:', error);
      toast.error('Failed to send expiry alerts');
    } finally {
      setSending(false);
    }
  };

  const currentDocs = activeTab === 'expiring' ? expiringDocs : expiredDocs;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
            <FileWarning className="w-7 h-7 text-primary-600" />
            Document Expiry Alerts
          </h1>
          <p className="text-warm-600 mt-1">
            Monitor and manage expiring employee documents
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <select
            value={daysFilter}
            onChange={(e) => setDaysFilter(parseInt(e.target.value))}
            className="border border-warm-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary-500 text-sm"
          >
            {DAYS_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Next {d} days
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-warm-900">
                {loading ? '-' : expiringDocs.length}
              </div>
              <div className="text-sm text-warm-500">Expiring Soon</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="p-3 bg-red-100 rounded-lg">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-warm-900">
                {loading ? '-' : expiredDocs.length}
              </div>
              <div className="text-sm text-warm-500">Already Expired</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="p-3 bg-red-100 rounded-lg">
              <Clock className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-warm-900">
                {loading
                  ? '-'
                  : expiringDocs.filter(
                      (d) => getDaysRemaining(d.expiryDate) < 7,
                    ).length}
              </div>
              <div className="text-sm text-warm-500">Critical (&lt;7 days)</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs + Actions */}
      <Card padding="none">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-warm-200">
          <div className="flex gap-1 bg-warm-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('expiring')}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                activeTab === 'expiring'
                  ? 'bg-white text-warm-900 shadow-sm'
                  : 'text-warm-600 hover:text-warm-900',
              )}
            >
              Expiring Soon
              {!loading && expiringDocs.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                  {expiringDocs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('expired')}
              className={cn(
                'px-4 py-2 rounded-md text-sm font-medium transition-all',
                activeTab === 'expired'
                  ? 'bg-white text-warm-900 shadow-sm'
                  : 'text-warm-600 hover:text-warm-900',
              )}
            >
              Already Expired
              {!loading && expiredDocs.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                  {expiredDocs.length}
                </span>
              )}
            </button>
          </div>
          {activeTab === 'expiring' && expiringDocs.length > 0 && (
            <Button
              onClick={handleSendAlerts}
              loading={sending}
              disabled={sending}
            >
              <Send className="w-4 h-4 mr-2" />
              Send Alerts
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Document</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Expiry Date</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingState colSpan={6} />
            ) : currentDocs.length === 0 ? (
              <TableEmptyState
                colSpan={6}
                message={
                  activeTab === 'expiring'
                    ? `No documents expiring in the next ${daysFilter} days`
                    : 'No expired documents found'
                }
              />
            ) : (
              currentDocs.map((doc) => {
                const daysRemaining = getDaysRemaining(doc.expiryDate);
                return (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium text-warm-900">
                          {doc.employee.firstName} {doc.employee.lastName}
                        </div>
                        <div className="text-xs text-warm-500">
                          {doc.employee.employeeCode}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {doc.employee.department?.name || '-'}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{doc.name}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="gray">
                        {doc.category.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(doc.expiryDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          activeTab === 'expired'
                            ? 'danger'
                            : getDaysBadgeVariant(daysRemaining)
                        }
                      >
                        {activeTab === 'expired'
                          ? getDaysLabel(daysRemaining)
                          : getDaysLabel(daysRemaining)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
