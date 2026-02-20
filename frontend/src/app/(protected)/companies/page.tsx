'use client';

import { useEffect, useState, useRef } from 'react';
import {
  Card, CardContent,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyState, TableLoadingState,
  Badge, Select, Input, Button,
  Modal, ModalFooter, FormError
} from '@/components/ui';
import {
  Search, Plus, Eye, Edit2, Trash2, Building2, Users,
  UserCheck, Power, PowerOff, Shield, Mail, MapPin,
  Upload, Globe, Phone, FileText, Settings, Clock, Calendar,
} from 'lucide-react';
import { companiesApi } from '@/lib/api';
import { Company, CompanyStats, UserRole } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { CreateCompanyWizard } from '@/components/companies/CreateCompanyWizard';
import toast from 'react-hot-toast';

type ViewTab = 'overview' | 'profile' | 'hr';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOptions = MONTHS.map((m, i) => ({ value: String(i + 1), label: `${m} (${i + 1})` }));

const COMPANY_TYPES = [
  { value: '', label: 'Select type...' },
  { value: 'PRIVATE_LIMITED', label: 'Private Limited (Pvt Ltd)' },
  { value: 'PUBLIC_LIMITED', label: 'Public Limited' },
  { value: 'LLP', label: 'Limited Liability Partnership (LLP)' },
  { value: 'OPC', label: 'One Person Company (OPC)' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'SOLE_PROPRIETORSHIP', label: 'Sole Proprietorship' },
  { value: 'TRUST', label: 'Trust / NGO' },
  { value: 'GOVERNMENT', label: 'Government' },
];

const PAYROLL_FREQ = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'BI_WEEKLY', label: 'Bi-Weekly' },
  { value: 'WEEKLY', label: 'Weekly' },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const getLogoUrl = (company: { id: string; logoUrl?: string | null }) =>
  company.logoUrl ? `${API_BASE}/companies/${company.id}/logo` : null;

interface ProfileForm {
  name: string;
  legalName: string;
  description: string;
  website: string;
  phone: string;
  email: string;
  industry: string;
  companyType: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pinCode: string;
  country: string;
  pan: string;
  gstin: string;
  tan: string;
  cin: string;
  pfRegistrationNumber: string;
  esiRegistrationNumber: string;
}

interface HRForm {
  timezone: string;
  currency: string;
  financialYearStartMonth: string;
  leaveYearStartMonth: string;
  workDaysPerWeek: string;
  standardWorkHoursPerDay: string;
  payrollFrequency: string;
  payrollProcessingDay: string;
}

const profileFromCompany = (c: Company): ProfileForm => ({
  name: c.name ?? '',
  legalName: c.legalName ?? '',
  description: c.description ?? '',
  website: c.website ?? '',
  phone: c.phone ?? '',
  email: c.email ?? '',
  industry: c.industry ?? '',
  companyType: c.companyType ?? '',
  addressLine1: c.addressLine1 ?? '',
  addressLine2: c.addressLine2 ?? '',
  city: c.city ?? '',
  state: c.state ?? '',
  pinCode: c.pinCode ?? '',
  country: c.country ?? '',
  pan: c.pan ?? '',
  gstin: c.gstin ?? '',
  tan: c.tan ?? '',
  cin: c.cin ?? '',
  pfRegistrationNumber: c.pfRegistrationNumber ?? '',
  esiRegistrationNumber: c.esiRegistrationNumber ?? '',
});

const hrFromCompany = (c: Company): HRForm => ({
  timezone: c.timezone ?? 'Asia/Kolkata',
  currency: c.currency ?? 'INR',
  financialYearStartMonth: String(c.financialYearStartMonth ?? 4),
  leaveYearStartMonth: String(c.leaveYearStartMonth ?? 4),
  workDaysPerWeek: String(c.workDaysPerWeek ?? 5),
  standardWorkHoursPerDay: String(c.standardWorkHoursPerDay ?? 8),
  payrollFrequency: c.payrollFrequency ?? 'MONTHLY',
  payrollProcessingDay: String(c.payrollProcessingDay ?? 28),
});

export default function CompaniesPage() {
  const { hasRole } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<CompanyStats | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);

  // View modal tab
  const [viewTab, setViewTab] = useState<ViewTab>('overview');

  // Geofencing
  const [geoEditMode, setGeoEditMode] = useState(false);
  const [geoLat, setGeoLat] = useState('');
  const [geoLon, setGeoLon] = useState('');
  const [geoRadius, setGeoRadius] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState('');

  // Profile edit
  const [profileEditMode, setProfileEditMode] = useState(false);
  const [profileForm, setProfileForm] = useState<ProfileForm>(profileFromCompany({} as Company));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Logo upload
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState('');

  // HR settings edit
  const [hrEditMode, setHrEditMode] = useState(false);
  const [hrForm, setHrForm] = useState<HRForm>(hrFromCompany({} as Company));
  const [hrSaving, setHrSaving] = useState(false);
  const [hrError, setHrError] = useState('');

  // Delete
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const isSuperAdmin = hasRole(UserRole.SUPER_ADMIN);

  useEffect(() => {
    loadCompanies();
    loadStats();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { loadCompanies(); }, 300);
    return () => clearTimeout(timer);
  }, [search, statusFilter]);

  const loadCompanies = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.isActive = statusFilter;
      const response = await companiesApi.getAll(params);
      setCompanies(response.data || []);
    } catch {
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await companiesApi.getStats();
      setStats(response.data);
    } catch { /* silent */ }
  };

  const handleViewCompany = async (company: Company) => {
    try {
      const response = await companiesApi.getById(company.id);
      const c: Company = response.data;
      setSelectedCompany(c);
      setViewTab('overview');
      setGeoEditMode(false);
      setGeoLat(c.officeLatitude != null ? String(c.officeLatitude) : '');
      setGeoLon(c.officeLongitude != null ? String(c.officeLongitude) : '');
      setGeoRadius(c.officeRadiusMeters != null ? String(c.officeRadiusMeters) : '');
      setGeoError('');
      setProfileEditMode(false);
      setProfileForm(profileFromCompany(c));
      setProfileError('');
      setHrEditMode(false);
      setHrForm(hrFromCompany(c));
      setHrError('');
      setLogoError('');
      setIsViewModalOpen(true);
    } catch {
      toast.error('Failed to load company details');
    }
  };

  // ---- Geofencing ----
  const handleSaveGeofencing = async () => {
    if (!selectedCompany) return;
    setGeoLoading(true);
    setGeoError('');
    try {
      const lat = geoLat.trim() ? parseFloat(geoLat) : null;
      const lon = geoLon.trim() ? parseFloat(geoLon) : null;
      const radius = geoRadius.trim() ? parseInt(geoRadius, 10) : null;

      if ((lat !== null && isNaN(lat)) || (lon !== null && isNaN(lon)) || (radius !== null && isNaN(radius))) {
        setGeoError('Please enter valid numeric values.');
        return;
      }
      if ((lat != null || lon != null || radius != null) && (lat == null || lon == null || radius == null)) {
        setGeoError('All three fields must be set together, or leave all empty to disable.');
        return;
      }

      const updated = await companiesApi.update(selectedCompany.id, {
        officeLatitude: lat, officeLongitude: lon, officeRadiusMeters: radius,
      });
      setSelectedCompany(updated.data);
      setGeoEditMode(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setGeoError(err.response?.data?.message || 'Failed to save geofencing settings');
    } finally {
      setGeoLoading(false);
    }
  };

  // ---- Profile ----
  const handleSaveProfile = async () => {
    if (!selectedCompany) return;
    if (!profileForm.name.trim()) {
      setProfileError('Company name is required');
      return;
    }
    setProfileSaving(true);
    setProfileError('');
    try {
      const payload: Record<string, unknown> = {};
      Object.entries(profileForm).forEach(([k, v]) => {
        // Always include 'name'; for optional fields, map empty string to undefined
        payload[k] = k === 'name' ? v.trim() : (v || undefined);
      });
      const updated = await companiesApi.update(selectedCompany.id, payload);
      setSelectedCompany(updated.data);
      setProfileEditMode(false);
      loadCompanies();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setProfileError(err.response?.data?.message || 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  // ---- Logo ----
  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedCompany) return;
    setLogoUploading(true);
    setLogoError('');
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await companiesApi.uploadLogo(selectedCompany.id, formData);
      setSelectedCompany({ ...selectedCompany, logoUrl: res.data.logoUrl });
      loadCompanies();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setLogoError(err.response?.data?.message || 'Logo upload failed. Max 2MB, images only.');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  // ---- HR Settings ----
  const handleSaveHRSettings = async () => {
    if (!selectedCompany) return;
    setHrSaving(true);
    setHrError('');
    try {
      const payload: Record<string, unknown> = {
        timezone: hrForm.timezone || undefined,
        currency: hrForm.currency || undefined,
        financialYearStartMonth: hrForm.financialYearStartMonth ? parseInt(hrForm.financialYearStartMonth) : undefined,
        leaveYearStartMonth: hrForm.leaveYearStartMonth ? parseInt(hrForm.leaveYearStartMonth) : undefined,
        workDaysPerWeek: hrForm.workDaysPerWeek ? parseInt(hrForm.workDaysPerWeek) : undefined,
        standardWorkHoursPerDay: hrForm.standardWorkHoursPerDay ? parseFloat(hrForm.standardWorkHoursPerDay) : undefined,
        payrollFrequency: hrForm.payrollFrequency || undefined,
        payrollProcessingDay: hrForm.payrollProcessingDay ? parseInt(hrForm.payrollProcessingDay) : undefined,
      };
      const updated = await companiesApi.update(selectedCompany.id, payload);
      setSelectedCompany(updated.data);
      setHrEditMode(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setHrError(err.response?.data?.message || 'Failed to save HR settings');
    } finally {
      setHrSaving(false);
    }
  };

  // ---- Toggle / Delete ----
  const handleToggleStatus = async (company: Company) => {
    try {
      await companiesApi.toggleStatus(company.id);
      loadCompanies();
      loadStats();
    } catch {
      toast.error('Failed to update company status');
    }
  };

  const handleDeleteCompany = (company: Company) => {
    setSelectedCompany(company);
    setDeleteError('');
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedCompany) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await companiesApi.delete(selectedCompany.id);
      setIsDeleteModalOpen(false);
      loadCompanies();
      loadStats();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setDeleteError(err.response?.data?.message || 'Failed to delete company');
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatDate = (d?: string) =>
    d ? new Date(d).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

  const val = (v?: string | null) => v || <span className="text-warm-400 italic">Not set</span>;

  // Access guard
  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <Shield className="h-6 w-6 text-red-600" />
            </div>
            <h2 className="text-xl font-semibold text-warm-900 mb-2">Access Denied</h2>
            <p className="text-warm-500">Only Super Admins can manage companies.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Companies</h1>
          <p className="text-warm-500">Manage organizations in the HRMS system</p>
        </div>
        <Button onClick={() => setIsAddModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Company
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[
            { icon: <Building2 className="h-5 w-5 text-blue-600" />, bg: 'bg-blue-100', label: 'Total Companies', value: stats.totalCompanies },
            { icon: <Power className="h-5 w-5 text-emerald-600" />, bg: 'bg-emerald-100', label: 'Active Companies', value: stats.activeCompanies },
            { icon: <Users className="h-5 w-5 text-purple-600" />, bg: 'bg-purple-100', label: 'Total Employees', value: stats.totalEmployees },
            { icon: <UserCheck className="h-5 w-5 text-orange-600" />, bg: 'bg-orange-100', label: 'Total Users', value: stats.totalUsers },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 ${s.bg} rounded-lg`}>{s.icon}</div>
                  <div>
                    <p className="text-sm text-warm-500">{s.label}</p>
                    <p className="text-2xl font-bold text-warm-900">{s.value}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-warm-400" />
              <Input placeholder="Search by company name or code..." value={search}
                onChange={(e) => setSearch(e.target.value)} className="pl-10" />
            </div>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              options={[{ value: '', label: 'All Status' }, { value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]}
              className="w-40" />
          </div>
        </CardContent>
      </Card>

      {/* Companies Table */}
      <Card padding="none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Employees</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingState colSpan={7} />
            ) : companies.length === 0 ? (
              <TableEmptyState
                message={search || statusFilter ? 'No companies match your filters' : 'No companies found. Add your first company!'}
                colSpan={7}
              />
            ) : (
              companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {getLogoUrl(company) ? (
                          <img src={getLogoUrl(company)!} alt={company.name} className="object-cover w-full h-full" />
                        ) : (
                          <Building2 className="h-5 w-5 text-primary-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-warm-900 truncate">{company.name}</p>
                        {company.legalName && (
                          <p className="text-xs text-warm-400 truncate">{company.legalName}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm bg-warm-100 px-2 py-1 rounded">{company.code}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-warm-500">
                      {[company.city, company.state, company.country].filter(Boolean).join(', ') || '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{company.employeeCount || 0}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={company.isActive ? 'success' : 'danger'}>
                      {company.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-warm-500">{formatDate(company.createdAt)}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => handleViewCompany(company)} title="View Details">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleToggleStatus(company)}
                        title={company.isActive ? 'Deactivate' : 'Activate'}
                        className={company.isActive ? 'text-orange-600 hover:text-orange-700 hover:bg-orange-50' : 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50'}>
                        {company.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteCompany(company)}
                        title="Delete" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* ==================== ADD COMPANY WIZARD ==================== */}
      <CreateCompanyWizard
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => { loadCompanies(); loadStats(); }}
      />

      {/* ==================== VIEW COMPANY MODAL ==================== */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Company Details" size="xl">
        {selectedCompany && (
          <>
            {/* Company header */}
            <div className="flex items-start gap-4 pb-4 border-b mb-0">
              <div className="h-16 w-16 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {getLogoUrl(selectedCompany) ? (
                  <img src={getLogoUrl(selectedCompany)!} alt={selectedCompany.name} className="object-cover w-full h-full" />
                ) : (
                  <Building2 className="h-8 w-8 text-primary-600" />
                )}
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-warm-900">{selectedCompany.name}</h3>
                {selectedCompany.legalName && (
                  <p className="text-sm text-warm-500">{selectedCompany.legalName}</p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="font-mono text-sm bg-warm-100 px-2 py-1 rounded">{selectedCompany.code}</span>
                  <Badge variant={selectedCompany.isActive ? 'success' : 'danger'}>
                    {selectedCompany.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {selectedCompany.currency && (
                    <span className="text-xs bg-warm-100 px-2 py-1 rounded text-warm-600">{selectedCompany.currency}</span>
                  )}
                  {selectedCompany.timezone && (
                    <span className="text-xs bg-warm-100 px-2 py-1 rounded text-warm-600">{selectedCompany.timezone}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="border-b mb-4">
              <div className="flex gap-0 -mb-px">
                {([
                  { id: 'overview', label: 'Overview', icon: <Users className="h-3.5 w-3.5" /> },
                  { id: 'profile', label: 'Profile', icon: <FileText className="h-3.5 w-3.5" /> },
                  { id: 'hr', label: 'HR Settings', icon: <Settings className="h-3.5 w-3.5" /> },
                ] as { id: ViewTab; label: string; icon: React.ReactNode }[]).map((tab) => (
                  <button key={tab.id} onClick={() => setViewTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                      viewTab === tab.id
                        ? 'border-primary-600 text-primary-600'
                        : 'border-transparent text-warm-500 hover:text-warm-700'
                    }`}>
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[50vh] overflow-y-auto space-y-5 pr-1">

              {/* ---- TAB: OVERVIEW ---- */}
              {viewTab === 'overview' && (
                <>
                  <div>
                    <h4 className="text-sm font-medium text-warm-900 mb-3">Statistics</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Total Employees', value: selectedCompany.employeeCount ?? 0 },
                        { label: 'Active Employees', value: selectedCompany.activeEmployeeCount ?? 0, color: 'text-emerald-600' },
                        { label: 'Users', value: selectedCompany.userCount ?? 0 },
                        { label: 'Departments', value: selectedCompany.departmentCount ?? 0 },
                        { label: 'Leave Types', value: selectedCompany.leaveTypeCount ?? 0 },
                        { label: 'OT Rules', value: selectedCompany.otRuleCount ?? 0 },
                      ].map((s) => (
                        <div key={s.label} className="p-3 bg-warm-50 rounded-lg text-center">
                          <p className={`text-2xl font-bold ${s.color ?? 'text-warm-900'}`}>{s.value}</p>
                          <p className="text-xs text-warm-500">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Geofencing */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-warm-900 flex items-center gap-2">
                        <MapPin className="h-4 w-4" /> Geofencing Settings
                      </h4>
                      {!geoEditMode && (
                        <Button variant="secondary" size="sm" onClick={() => setGeoEditMode(true)}>
                          <Edit2 className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      )}
                    </div>
                    {geoEditMode ? (
                      <div className="space-y-3">
                        {geoError && <p className="text-xs text-red-600">{geoError}</p>}
                        <p className="text-xs text-warm-500">Leave all empty to disable geofencing.</p>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: 'Latitude', val: geoLat, set: setGeoLat, ph: '28.6139' },
                            { label: 'Longitude', val: geoLon, set: setGeoLon, ph: '77.2090' },
                            { label: 'Radius (m)', val: geoRadius, set: setGeoRadius, ph: '200' },
                          ].map((f) => (
                            <div key={f.label}>
                              <label className="block text-xs font-medium text-warm-700 mb-1">{f.label}</label>
                              <input type="number" step="any" placeholder={f.ph} value={f.val}
                                onChange={(e) => f.set(e.target.value)}
                                className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleSaveGeofencing} disabled={geoLoading}>
                            {geoLoading ? 'Saving...' : 'Save'}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => {
                            setGeoEditMode(false);
                            setGeoError('');
                            setGeoLat(selectedCompany.officeLatitude != null ? String(selectedCompany.officeLatitude) : '');
                            setGeoLon(selectedCompany.officeLongitude != null ? String(selectedCompany.officeLongitude) : '');
                            setGeoRadius(selectedCompany.officeRadiusMeters != null ? String(selectedCompany.officeRadiusMeters) : '');
                          }}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-4">
                        {[
                          { label: 'Latitude', value: selectedCompany.officeLatitude },
                          { label: 'Longitude', value: selectedCompany.officeLongitude },
                          { label: 'Radius', value: selectedCompany.officeRadiusMeters != null ? `${selectedCompany.officeRadiusMeters}m` : null },
                        ].map((f) => (
                          <div key={f.label} className="p-3 bg-warm-50 rounded-lg">
                            <p className="text-xs text-warm-500">{f.label}</p>
                            <p className="text-sm font-medium">
                              {f.value != null ? f.value : <span className="text-warm-400">Disabled</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Timeline */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-warm-50 rounded-lg">
                      <p className="text-xs text-warm-500">Created</p>
                      <p className="text-sm font-medium">{formatDate(selectedCompany.createdAt)}</p>
                    </div>
                    <div className="p-3 bg-warm-50 rounded-lg">
                      <p className="text-xs text-warm-500">Last Updated</p>
                      <p className="text-sm font-medium">{formatDate(selectedCompany.updatedAt)}</p>
                    </div>
                  </div>
                </>
              )}

              {/* ---- TAB: PROFILE ---- */}
              {viewTab === 'profile' && (
                <>
                  {/* Logo */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-warm-900 flex items-center gap-2">
                        <Building2 className="h-4 w-4" /> Company Logo
                      </h4>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="h-20 w-20 rounded-lg border-2 border-dashed border-warm-300 flex items-center justify-center overflow-hidden bg-warm-50">
                        {getLogoUrl(selectedCompany) ? (
                          <img src={getLogoUrl(selectedCompany)!} alt="Logo" className="object-contain w-full h-full" />
                        ) : (
                          <Building2 className="h-8 w-8 text-warm-300" />
                        )}
                      </div>
                      <div>
                        <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                          onChange={handleLogoFileChange} />
                        <Button variant="secondary" size="sm" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}>
                          <Upload className="h-3.5 w-3.5 mr-1.5" />
                          {logoUploading ? 'Uploading...' : 'Upload Logo'}
                        </Button>
                        <p className="text-xs text-warm-500 mt-1">PNG, JPG, WebP · Max 2MB</p>
                        {logoError && <p className="text-xs text-red-600 mt-1">{logoError}</p>}
                      </div>
                    </div>
                  </div>

                  {/* Basic Info */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-warm-900 flex items-center gap-2">
                        <FileText className="h-4 w-4" /> Basic Information
                      </h4>
                      {!profileEditMode && (
                        <Button variant="secondary" size="sm" onClick={() => setProfileEditMode(true)}>
                          <Edit2 className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      )}
                    </div>

                    {profileError && <p className="text-xs text-red-600 mb-2">{profileError}</p>}

                    {profileEditMode ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-warm-700 mb-1">Display Name *</label>
                            <input value={profileForm.name} onChange={(e) => setProfileForm(p => ({ ...p, name: e.target.value }))}
                              className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-warm-700 mb-1">Legal / Registered Name</label>
                            <input value={profileForm.legalName} onChange={(e) => setProfileForm(p => ({ ...p, legalName: e.target.value }))}
                              placeholder="As per incorporation documents"
                              className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-warm-700 mb-1">Industry</label>
                            <input value={profileForm.industry} onChange={(e) => setProfileForm(p => ({ ...p, industry: e.target.value }))}
                              placeholder="e.g. IT & Software"
                              className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-warm-700 mb-1">Company Type</label>
                            <select value={profileForm.companyType} onChange={(e) => setProfileForm(p => ({ ...p, companyType: e.target.value }))}
                              className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                              {COMPANY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-warm-700 mb-1">Website</label>
                            <input value={profileForm.website} onChange={(e) => setProfileForm(p => ({ ...p, website: e.target.value }))}
                              placeholder="https://example.com"
                              className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-warm-700 mb-1">Contact Phone</label>
                            <input value={profileForm.phone} onChange={(e) => setProfileForm(p => ({ ...p, phone: e.target.value }))}
                              placeholder="+91 99999 99999"
                              className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-warm-700 mb-1">Contact Email</label>
                            <input value={profileForm.email} onChange={(e) => setProfileForm(p => ({ ...p, email: e.target.value }))}
                              type="email" placeholder="hr@company.com"
                              className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-warm-700 mb-1">Description</label>
                            <textarea value={profileForm.description} onChange={(e) => setProfileForm(p => ({ ...p, description: e.target.value }))}
                              rows={2} placeholder="Brief company description..."
                              className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" />
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold text-warm-600 uppercase tracking-wide mb-2">Registered Address</p>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: 'Address Line 1', key: 'addressLine1' as const, ph: '123 Main Street', col: 2 },
                              { label: 'Address Line 2', key: 'addressLine2' as const, ph: 'Suite 400', col: 2 },
                              { label: 'City', key: 'city' as const, ph: 'Mumbai', col: 1 },
                              { label: 'State', key: 'state' as const, ph: 'Maharashtra', col: 1 },
                              { label: 'PIN Code', key: 'pinCode' as const, ph: '400001', col: 1 },
                              { label: 'Country', key: 'country' as const, ph: 'India', col: 1 },
                            ].map((f) => (
                              <div key={f.key} className={f.col === 2 ? 'col-span-2' : ''}>
                                <label className="block text-xs font-medium text-warm-700 mb-1">{f.label}</label>
                                <input value={profileForm[f.key]} placeholder={f.ph}
                                  onChange={(e) => setProfileForm(p => ({ ...p, [f.key]: e.target.value }))}
                                  className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold text-warm-600 uppercase tracking-wide mb-2">Legal / Tax Identifiers</p>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: 'PAN', key: 'pan' as const, ph: 'AAAAA9999A' },
                              { label: 'GSTIN', key: 'gstin' as const, ph: '27AAAAA9999A1Z5' },
                              { label: 'TAN', key: 'tan' as const, ph: 'AAAA99999A' },
                              { label: 'CIN', key: 'cin' as const, ph: 'L17110MH1973PLC019786' },
                              { label: 'PF Registration No.', key: 'pfRegistrationNumber' as const, ph: 'MHBAN0000000000' },
                              { label: 'ESI Registration No.', key: 'esiRegistrationNumber' as const, ph: '00000000000000000' },
                            ].map((f) => (
                              <div key={f.key}>
                                <label className="block text-xs font-medium text-warm-700 mb-1">{f.label}</label>
                                <input value={profileForm[f.key]} placeholder={f.ph}
                                  onChange={(e) => setProfileForm(p => ({ ...p, [f.key]: e.target.value.toUpperCase() }))}
                                  className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500" />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <Button size="sm" onClick={handleSaveProfile} disabled={profileSaving}>
                            {profileSaving ? 'Saving...' : 'Save Profile'}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => { setProfileEditMode(false); setProfileError(''); }}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: 'Display Name', value: selectedCompany.name },
                            { label: 'Legal Name', value: selectedCompany.legalName },
                            { label: 'Industry', value: selectedCompany.industry },
                            { label: 'Company Type', value: COMPANY_TYPES.find(t => t.value === selectedCompany.companyType)?.label ?? selectedCompany.companyType },
                          ].map((f) => (
                            <div key={f.label} className="p-3 bg-warm-50 rounded-lg">
                              <p className="text-xs text-warm-500">{f.label}</p>
                              <p className="text-sm font-medium">{val(f.value)}</p>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            { label: 'Website', icon: <Globe className="h-3.5 w-3.5" />, value: selectedCompany.website },
                            { label: 'Phone', icon: <Phone className="h-3.5 w-3.5" />, value: selectedCompany.phone },
                            { label: 'Email', icon: <Mail className="h-3.5 w-3.5" />, value: selectedCompany.email },
                          ].map((f) => (
                            <div key={f.label} className="p-3 bg-warm-50 rounded-lg">
                              <p className="text-xs text-warm-500 flex items-center gap-1">{f.icon}{f.label}</p>
                              <p className="text-sm font-medium truncate">{val(f.value)}</p>
                            </div>
                          ))}
                        </div>
                        {selectedCompany.description && (
                          <div className="p-3 bg-warm-50 rounded-lg">
                            <p className="text-xs text-warm-500 mb-1">Description</p>
                            <p className="text-sm">{selectedCompany.description}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-semibold text-warm-600 uppercase tracking-wide mb-2">Address</p>
                          <div className="p-3 bg-warm-50 rounded-lg">
                            {[selectedCompany.addressLine1, selectedCompany.addressLine2,
                              [selectedCompany.city, selectedCompany.state, selectedCompany.pinCode].filter(Boolean).join(', '),
                              selectedCompany.country].filter(Boolean).join('\n') || <span className="text-warm-400 italic text-sm">Not set</span>}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-warm-600 uppercase tracking-wide mb-2">Legal / Tax Identifiers</p>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: 'PAN', value: selectedCompany.pan },
                              { label: 'GSTIN', value: selectedCompany.gstin },
                              { label: 'TAN', value: selectedCompany.tan },
                              { label: 'CIN', value: selectedCompany.cin },
                              { label: 'PF Reg. No.', value: selectedCompany.pfRegistrationNumber },
                              { label: 'ESI Reg. No.', value: selectedCompany.esiRegistrationNumber },
                            ].map((f) => (
                              <div key={f.label} className="p-3 bg-warm-50 rounded-lg">
                                <p className="text-xs text-warm-500">{f.label}</p>
                                <p className="text-sm font-mono font-medium">{val(f.value)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ---- TAB: HR SETTINGS ---- */}
              {viewTab === 'hr' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-medium text-warm-900 flex items-center gap-2">
                      <Settings className="h-4 w-4" /> HR & Payroll Configuration
                    </h4>
                    {!hrEditMode && (
                      <Button variant="secondary" size="sm" onClick={() => setHrEditMode(true)}>
                        <Edit2 className="h-3 w-3 mr-1" /> Edit
                      </Button>
                    )}
                  </div>

                  {hrError && <p className="text-xs text-red-600 mb-3">{hrError}</p>}

                  {hrEditMode ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-warm-700 mb-1">Timezone</label>
                          <input value={hrForm.timezone} onChange={(e) => setHrForm(p => ({ ...p, timezone: e.target.value }))}
                            placeholder="Asia/Kolkata"
                            className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-warm-700 mb-1">Currency (ISO 4217)</label>
                          <input value={hrForm.currency} onChange={(e) => setHrForm(p => ({ ...p, currency: e.target.value.toUpperCase() }))}
                            placeholder="INR" maxLength={3}
                            className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-warm-700 mb-1">Financial Year Start</label>
                          <select value={hrForm.financialYearStartMonth} onChange={(e) => setHrForm(p => ({ ...p, financialYearStartMonth: e.target.value }))}
                            className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                            {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-warm-700 mb-1">Leave Year Start</label>
                          <select value={hrForm.leaveYearStartMonth} onChange={(e) => setHrForm(p => ({ ...p, leaveYearStartMonth: e.target.value }))}
                            className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                            {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-warm-700 mb-1">Work Days / Week</label>
                          <input type="number" min={1} max={7} value={hrForm.workDaysPerWeek}
                            onChange={(e) => setHrForm(p => ({ ...p, workDaysPerWeek: e.target.value }))}
                            className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-warm-700 mb-1">Standard Hours / Day</label>
                          <input type="number" min={1} max={24} step="0.5" value={hrForm.standardWorkHoursPerDay}
                            onChange={(e) => setHrForm(p => ({ ...p, standardWorkHoursPerDay: e.target.value }))}
                            className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-warm-700 mb-1">Payroll Frequency</label>
                          <select value={hrForm.payrollFrequency} onChange={(e) => setHrForm(p => ({ ...p, payrollFrequency: e.target.value }))}
                            className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                            {PAYROLL_FREQ.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-warm-700 mb-1">Payroll Processing Day</label>
                          <input type="number" min={1} max={31} value={hrForm.payrollProcessingDay}
                            onChange={(e) => setHrForm(p => ({ ...p, payrollProcessingDay: e.target.value }))}
                            className="w-full border border-warm-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                          <p className="text-xs text-warm-400 mt-0.5">Day of month payroll is processed</p>
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button size="sm" onClick={handleSaveHRSettings} disabled={hrSaving}>
                          {hrSaving ? 'Saving...' : 'Save HR Settings'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => { setHrEditMode(false); setHrError(''); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { label: 'Timezone', icon: <Clock className="h-3.5 w-3.5" />, value: selectedCompany.timezone },
                          { label: 'Currency', icon: null, value: selectedCompany.currency },
                          { label: 'Financial Year Start', icon: <Calendar className="h-3.5 w-3.5" />, value: selectedCompany.financialYearStartMonth ? MONTHS[(selectedCompany.financialYearStartMonth ?? 4) - 1] : null },
                          { label: 'Leave Year Start', icon: <Calendar className="h-3.5 w-3.5" />, value: selectedCompany.leaveYearStartMonth ? MONTHS[(selectedCompany.leaveYearStartMonth ?? 4) - 1] : null },
                          { label: 'Work Days / Week', icon: null, value: selectedCompany.workDaysPerWeek != null ? `${selectedCompany.workDaysPerWeek} days` : null },
                          { label: 'Standard Hours / Day', icon: null, value: selectedCompany.standardWorkHoursPerDay != null ? `${selectedCompany.standardWorkHoursPerDay} hrs` : null },
                          { label: 'Payroll Frequency', icon: null, value: PAYROLL_FREQ.find(f => f.value === selectedCompany.payrollFrequency)?.label ?? selectedCompany.payrollFrequency },
                          { label: 'Payroll Processing Day', icon: null, value: selectedCompany.payrollProcessingDay != null ? `Day ${selectedCompany.payrollProcessingDay}` : null },
                        ].map((f) => (
                          <div key={f.label} className="p-3 bg-warm-50 rounded-lg">
                            <p className="text-xs text-warm-500 flex items-center gap-1">{f.icon}{f.label}</p>
                            <p className="text-sm font-medium">{val(f.value)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <ModalFooter>
              <Button variant="secondary" onClick={() => setIsViewModalOpen(false)}>Close</Button>
            </ModalFooter>
          </>
        )}
      </Modal>

      {/* ==================== DELETE MODAL ==================== */}
      <Modal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} title="Delete Company" size="sm">
        <div className="space-y-4">
          <FormError message={deleteError} />
          <div className="text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <Trash2 className="h-6 w-6 text-red-600" />
            </div>
            <p className="text-warm-900 font-medium">Are you sure you want to delete this company?</p>
            {selectedCompany && (
              <p className="text-warm-500 mt-1">{selectedCompany.name} ({selectedCompany.code})</p>
            )}
            <p className="text-sm text-warm-400 mt-2">
              Companies with existing employees cannot be deleted. Deactivate them instead.
            </p>
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirmDelete} disabled={deleteLoading}
            className="bg-red-600 hover:bg-red-700">
            {deleteLoading ? 'Deleting...' : 'Delete Company'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
