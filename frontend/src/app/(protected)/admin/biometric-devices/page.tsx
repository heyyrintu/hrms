'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { biometricApi, employeesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Cpu,
  Plus,
  Edit2,
  RefreshCw,
  Search,
  Activity,
  Users,
  List,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Employee } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BiometricDevice {
  id: string;
  serialNumber: string;
  name: string;
  deviceType: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

interface DeviceLog {
  id: string;
  deviceUserId: string;
  punchTime: string;
  punchType: number; // 0 = in, 1 = out
  verifyType: number; // 15 = face
  processed: boolean;
  employeeId: string | null;
  error: string | null;
  rawData: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
};

const timeSince = (iso: string | null) => {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const punchLabel = (type: number) => (type === 0 ? 'Clock In' : type === 1 ? 'Clock Out' : `Type ${type}`);
const verifyLabel = (type: number) => {
  const map: Record<number, string> = { 0: 'Fingerprint', 1: 'Password', 2: 'Card', 15: 'Face' };
  return map[type] ?? `Verify ${type}`;
};

// ─── Empty forms ──────────────────────────────────────────────────────────────

const emptyDeviceForm = { serialNumber: '', name: '', deviceType: 'ESSL_ICLOCK' };

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabId = 'devices' | 'employees' | 'logs';

export default function BiometricDevicesPage() {
  const [tab, setTab] = useState<TabId>('devices');

  // ── Device state ──
  const [devices, setDevices] = useState<BiometricDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [deviceModal, setDeviceModal] = useState(false);
  const [editingDevice, setEditingDevice] = useState<BiometricDevice | null>(null);
  const [deviceForm, setDeviceForm] = useState(emptyDeviceForm);
  const [savingDevice, setSavingDevice] = useState(false);

  // ── Employee mapping state ──
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empLoading, setEmpLoading] = useState(true);
  const [empSearch, setEmpSearch] = useState('');
  const [mappingModal, setMappingModal] = useState(false);
  const [mappingEmployee, setMappingEmployee] = useState<Employee | null>(null);
  const [biometricUserId, setBiometricUserId] = useState('');
  const [savingMapping, setSavingMapping] = useState(false);

  // ── Logs state ──
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [logs, setLogs] = useState<DeviceLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSearch, setLogSearch] = useState('');

  useEffect(() => {
    loadDevices();
    loadEmployees();
  }, []);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadDevices = async () => {
    setDevicesLoading(true);
    try {
      const res = await biometricApi.listDevices();
      setDevices(res.data);
    } catch {
      toast.error('Failed to load devices');
    } finally {
      setDevicesLoading(false);
    }
  };

  const loadEmployees = async () => {
    setEmpLoading(true);
    try {
      const res = await employeesApi.getAll({ status: 'ACTIVE' });
      setEmployees(res.data?.data ?? res.data ?? []);
    } catch {
      toast.error('Failed to load employees');
    } finally {
      setEmpLoading(false);
    }
  };

  const loadLogs = async (deviceId: string) => {
    if (!deviceId) return;
    setLogsLoading(true);
    try {
      const res = await biometricApi.getDeviceLogs(deviceId, 200);
      setLogs(res.data);
    } catch {
      toast.error('Failed to load device logs');
    } finally {
      setLogsLoading(false);
    }
  };

  // ── Device handlers ───────────────────────────────────────────────────────────

  const openCreateDevice = () => {
    setEditingDevice(null);
    setDeviceForm(emptyDeviceForm);
    setDeviceModal(true);
  };

  const openEditDevice = (device: BiometricDevice) => {
    setEditingDevice(device);
    setDeviceForm({ serialNumber: device.serialNumber, name: device.name, deviceType: device.deviceType });
    setDeviceModal(true);
  };

  const handleSaveDevice = async () => {
    if (!deviceForm.serialNumber.trim() || !deviceForm.name.trim()) return;
    setSavingDevice(true);
    try {
      if (editingDevice) {
        await biometricApi.updateDevice(editingDevice.id, { name: deviceForm.name });
        toast.success('Device updated');
      } else {
        await biometricApi.registerDevice({
          serialNumber: deviceForm.serialNumber.trim(),
          name: deviceForm.name.trim(),
          deviceType: deviceForm.deviceType || undefined,
        });
        toast.success('Device registered');
      }
      setDeviceModal(false);
      await loadDevices();
    } catch {
      toast.error('Failed to save device');
    } finally {
      setSavingDevice(false);
    }
  };

  const toggleDeviceActive = async (device: BiometricDevice) => {
    try {
      await biometricApi.updateDevice(device.id, { isActive: !device.isActive });
      toast.success(device.isActive ? 'Device deactivated' : 'Device activated');
      await loadDevices();
    } catch {
      toast.error('Failed to update device');
    }
  };

  // ── Employee mapping handlers ─────────────────────────────────────────────────

  const openMappingModal = (emp: Employee) => {
    setMappingEmployee(emp);
    setBiometricUserId((emp as Employee & { biometricUserId?: string }).biometricUserId ?? '');
    setMappingModal(true);
  };

  const handleSaveMapping = async () => {
    if (!mappingEmployee || !biometricUserId.trim()) return;
    setSavingMapping(true);
    try {
      await biometricApi.setEmployeeBiometricId(mappingEmployee.id, biometricUserId.trim());
      toast.success('Biometric ID assigned');
      setMappingModal(false);
      await loadEmployees();
    } catch {
      toast.error('Failed to assign biometric ID');
    } finally {
      setSavingMapping(false);
    }
  };

  // ── Log tab helpers ───────────────────────────────────────────────────────────

  const handleDeviceSelect = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setLogs([]);
    if (deviceId) loadLogs(deviceId);
  };

  const filteredEmployees = employees.filter((e) => {
    const q = empSearch.toLowerCase();
    return (
      e.firstName?.toLowerCase().includes(q) ||
      e.lastName?.toLowerCase().includes(q) ||
      e.employeeCode?.toLowerCase().includes(q)
    );
  });

  const filteredLogs = logs.filter((l) =>
    logSearch === '' ||
    l.deviceUserId.includes(logSearch) ||
    (l.error ?? '').toLowerCase().includes(logSearch.toLowerCase()),
  );

  const activeDevices = devices.filter((d) => d.isActive).length;
  const mappedEmployees = employees.filter(
    (e) => !!(e as Employee & { biometricUserId?: string }).biometricUserId,
  ).length;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
              <Cpu className="w-7 h-7 text-primary-600" />
              Biometric Devices
            </h1>
            <p className="text-warm-600 mt-1">Manage ESSL face recognition attendance devices</p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { loadDevices(); loadEmployees(); }} disabled={devicesLoading}>
              <RefreshCw className={cn('w-4 h-4 mr-2', devicesLoading && 'animate-spin')} />
              Refresh
            </Button>
            {tab === 'devices' && (
              <Button onClick={openCreateDevice}>
                <Plus className="w-4 h-4 mr-2" />
                Register Device
              </Button>
            )}
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-warm-900">{devices.length}</p>
              <p className="text-sm text-warm-500">Total Devices</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{activeDevices}</p>
              <p className="text-sm text-warm-500">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-primary-600">{mappedEmployees}</p>
              <p className="text-sm text-warm-500">Employees Mapped</p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-warm-200">
          {([
            { id: 'devices', label: 'Devices', icon: Cpu },
            { id: 'employees', label: 'Employee Mapping', icon: Users },
            { id: 'logs', label: 'Punch Logs', icon: List },
          ] as { id: TabId; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-warm-500 hover:text-warm-900',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* ── TAB: Devices ─────────────────────────────────────────────────────── */}
        {tab === 'devices' && (
          devicesLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
            </div>
          ) : devices.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Cpu className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-warm-900 mb-2">No Devices Registered</h3>
                <p className="text-warm-600 mb-4">
                  Register your ESSL biometric device to start syncing attendance automatically.
                </p>
                <Button onClick={openCreateDevice}>
                  <Plus className="w-4 h-4 mr-2" />
                  Register Device
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-warm-200 bg-warm-50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Device</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Serial Number</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Last Seen</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-warm-200">
                    {devices.map((device) => (
                      <tr key={device.id} className="hover:bg-warm-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                              <Cpu className="w-4 h-4 text-primary-600" />
                            </div>
                            <span className="text-sm font-medium text-warm-900">{device.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <code className="text-xs bg-warm-100 text-warm-700 px-2 py-1 rounded font-mono">
                            {device.serialNumber}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-sm text-warm-600">{device.deviceType}</td>
                        <td className="px-4 py-3">
                          <Badge variant={device.isActive ? 'success' : 'gray'}>
                            {device.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 text-sm text-warm-600">
                            <Activity className="w-3.5 h-3.5" />
                            {timeSince(device.lastSeenAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => openEditDevice(device)}
                            className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                            title="Edit name"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { setTab('logs'); handleDeviceSelect(device.id); }}
                            className="p-2 text-warm-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                            title="View logs"
                          >
                            <List className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleDeviceActive(device)}
                            className={cn(
                              'p-2 rounded-lg transition-colors',
                              device.isActive
                                ? 'text-warm-400 hover:text-red-600 hover:bg-red-50'
                                : 'text-warm-400 hover:text-emerald-600 hover:bg-emerald-50',
                            )}
                            title={device.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {device.isActive ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Setup instructions */}
              <div className="border-t border-warm-200 px-4 py-4 bg-blue-50">
                <h4 className="text-sm font-semibold text-blue-900 mb-1 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Device Setup Instructions
                </h4>
                <p className="text-xs text-blue-700">
                  In the device web interface, go to <strong>Communication → Cloud/ADMS Server</strong> and set:
                  {' '}<code className="bg-blue-100 px-1 rounded">Server Address</code> = your HRMS domain,
                  {' '}<code className="bg-blue-100 px-1 rounded">Server Path</code> = <strong>/iclock</strong>,
                  {' '}<code className="bg-blue-100 px-1 rounded">Port</code> = 443 (HTTPS) or 80 (HTTP).
                  Then save and reboot the device.
                </p>
              </div>
            </Card>
          )
        )}

        {/* ── TAB: Employee Mapping ─────────────────────────────────────────── */}
        {tab === 'employees' && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
              <input
                type="text"
                placeholder="Search employees..."
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            {empLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
              </div>
            ) : (
              <Card>
                <div className="px-4 py-3 border-b border-warm-200 bg-warm-50">
                  <p className="text-xs text-warm-500">
                    Assign the numeric user ID that is enrolled in the biometric device to each employee.
                    This ID must match exactly what was set when enrolling the employee&apos;s face on the device.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-warm-200">
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Employee</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Code</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Department</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Biometric ID</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-warm-200">
                      {filteredEmployees.map((emp) => {
                        const bioId = (emp as Employee & { biometricUserId?: string }).biometricUserId;
                        return (
                          <tr key={emp.id} className="hover:bg-warm-50 transition-colors">
                            <td className="px-4 py-3">
                              <p className="text-sm font-medium text-warm-900">
                                {emp.firstName} {emp.lastName}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-sm text-warm-600">{emp.employeeCode}</td>
                            <td className="px-4 py-3 text-sm text-warm-600">
                              {(emp as Employee & { department?: { name: string } }).department?.name ?? '—'}
                            </td>
                            <td className="px-4 py-3">
                              {bioId ? (
                                <code className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-mono">
                                  {bioId}
                                </code>
                              ) : (
                                <span className="text-xs text-warm-400 italic">Not assigned</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => openMappingModal(emp)}
                                className="text-xs text-primary-600 hover:text-primary-800 font-medium hover:underline"
                              >
                                {bioId ? 'Change' : 'Assign'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {filteredEmployees.length === 0 && (
                    <div className="py-12 text-center">
                      <Users className="w-12 h-12 text-warm-300 mx-auto mb-3" />
                      <p className="text-warm-500">No employees found</p>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </>
        )}

        {/* ── TAB: Punch Logs ───────────────────────────────────────────────── */}
        {tab === 'logs' && (
          <>
            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={selectedDeviceId}
                onChange={(e) => handleDeviceSelect(e.target.value)}
                className="border border-warm-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 bg-white"
              >
                <option value="">Select a device...</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.serialNumber})
                  </option>
                ))}
              </select>
              {selectedDeviceId && (
                <>
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
                    <input
                      type="text"
                      placeholder="Filter by user ID or error..."
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                    />
                  </div>
                  <Button variant="secondary" onClick={() => loadLogs(selectedDeviceId)} disabled={logsLoading}>
                    <RefreshCw className={cn('w-4 h-4 mr-2', logsLoading && 'animate-spin')} />
                    Reload
                  </Button>
                </>
              )}
            </div>

            {!selectedDeviceId ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <List className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                  <p className="text-warm-500">Select a device above to view punch logs</p>
                </CardContent>
              </Card>
            ) : logsLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Clock className="w-12 h-12 text-warm-300 mx-auto mb-3" />
                  <p className="text-warm-500">No punch logs found for this device</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <div className="px-4 py-3 border-b border-warm-200 flex items-center justify-between">
                  <p className="text-sm text-warm-600">
                    Showing {filteredLogs.length} log entries (latest first)
                  </p>
                  <div className="flex gap-3 text-xs text-warm-500">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Processed
                    </span>
                    <span className="flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500" /> Error
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-warm-400" /> Pending
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-warm-200 bg-warm-50">
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Status</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Punch Time</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Device User ID</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Type</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Verify</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Error / Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-warm-200">
                      {filteredLogs.map((log) => (
                        <tr
                          key={log.id}
                          className={cn(
                            'hover:bg-warm-50 transition-colors',
                            log.error && 'bg-red-50 hover:bg-red-100',
                          )}
                        >
                          <td className="px-4 py-2.5">
                            {log.error ? (
                              <span title="Error"><AlertCircle className="w-4 h-4 text-red-500" /></span>
                            ) : log.processed ? (
                              <span title="Processed"><CheckCircle2 className="w-4 h-4 text-emerald-500" /></span>
                            ) : (
                              <span title="Pending"><Clock className="w-4 h-4 text-warm-400" /></span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-warm-900 font-medium whitespace-nowrap">
                            {formatDateTime(log.punchTime)}
                          </td>
                          <td className="px-4 py-2.5">
                            <code className="text-xs bg-warm-100 text-warm-700 px-1.5 py-0.5 rounded font-mono">
                              {log.deviceUserId}
                            </code>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant={log.punchType === 0 ? 'success' : 'info'}>
                              {punchLabel(log.punchType)}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-warm-600">{verifyLabel(log.verifyType)}</td>
                          <td className="px-4 py-2.5 text-xs text-red-600 max-w-xs truncate">
                            {log.error ?? ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* ── Modal: Register / Edit Device ───────────────────────────────────── */}
      <Modal
        isOpen={deviceModal}
        onClose={() => setDeviceModal(false)}
        title={editingDevice ? 'Edit Device' : 'Register Biometric Device'}
        size="md"
      >
        <div className="space-y-4">
          {!editingDevice && (
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Serial Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={deviceForm.serialNumber}
                onChange={(e) => setDeviceForm((f) => ({ ...f, serialNumber: e.target.value }))}
                placeholder="e.g. ABC12345678"
                className="w-full border border-warm-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500"
              />
              <p className="text-xs text-warm-500 mt-1">
                Find this in the device web interface under Device Info / About.
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Device Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={deviceForm.name}
              onChange={(e) => setDeviceForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Main Entrance, Factory Gate"
              className="w-full border border-warm-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500"
            />
          </div>
          {!editingDevice && (
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Device Type</label>
              <input
                type="text"
                value={deviceForm.deviceType}
                onChange={(e) => setDeviceForm((f) => ({ ...f, deviceType: e.target.value }))}
                placeholder="ESSL_ICLOCK"
                className="w-full border border-warm-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 bg-warm-50"
              />
            </div>
          )}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeviceModal(false)} disabled={savingDevice}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveDevice}
            loading={savingDevice}
            disabled={!deviceForm.name.trim() || (!editingDevice && !deviceForm.serialNumber.trim())}
          >
            {editingDevice ? 'Update' : 'Register'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Modal: Assign Biometric ID ──────────────────────────────────────── */}
      <Modal
        isOpen={mappingModal}
        onClose={() => setMappingModal(false)}
        title="Assign Biometric ID"
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-warm-50 rounded-lg">
            <p className="text-sm font-medium text-warm-900">
              {mappingEmployee?.firstName} {mappingEmployee?.lastName}
            </p>
            <p className="text-xs text-warm-500">{mappingEmployee?.employeeCode}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Device User ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={biometricUserId}
              onChange={(e) => setBiometricUserId(e.target.value)}
              placeholder="e.g. 42"
              className="w-full border border-warm-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
            <p className="text-xs text-warm-500 mt-1">
              This must match the user ID assigned when enrolling this employee&apos;s face in the device.
            </p>
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setMappingModal(false)} disabled={savingMapping}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveMapping}
            loading={savingMapping}
            disabled={!biometricUserId.trim()}
          >
            Save
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
