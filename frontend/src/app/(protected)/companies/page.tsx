'use client';

import { useEffect, useState } from 'react';
import { 
  Card, CardHeader, CardTitle, CardContent,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyState, TableLoadingState,
  Badge, Select, Input, Button,
  Modal, ModalFooter, FormRow, FormGrid, FormError, FormSuccess
} from '@/components/ui';
import { 
  Search, Plus, Eye, Edit2, Trash2, Building2, Users, 
  UserCheck, Power, PowerOff, Shield, Mail, Key, User
} from 'lucide-react';
import { api } from '@/lib/api';
import { Company, CompanyStats, CreateCompanyPayload, UserRole } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

interface CompanyFormData {
  name: string;
  code: string;
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
}

const initialFormData: CompanyFormData = {
  name: '',
  code: '',
  adminEmail: '',
  adminPassword: '',
  adminFirstName: '',
  adminLastName: '',
};

export default function CompaniesPage() {
  const { user, hasRole } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<CompanyStats | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  
  // Form state
  const [formData, setFormData] = useState<CompanyFormData>(initialFormData);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const isSuperAdmin = hasRole(UserRole.SUPER_ADMIN);

  useEffect(() => {
    loadCompanies();
    loadStats();
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadCompanies();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, statusFilter]);

  const loadCompanies = async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (statusFilter) params.isActive = statusFilter;

      const response = await api.get<Company[]>('/companies', { params });
      setCompanies(response.data || []);
    } catch (error) {
      console.error('Failed to load companies:', error);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await api.get<CompanyStats>('/companies/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const handleViewCompany = async (company: Company) => {
    try {
      const response = await api.get<Company>(`/companies/${company.id}`);
      setSelectedCompany(response.data);
      setIsViewModalOpen(true);
    } catch (error) {
      console.error('Failed to load company details:', error);
    }
  };

  const handleDeleteCompany = (company: Company) => {
    setSelectedCompany(company);
    setFormError('');
    setIsDeleteModalOpen(true);
  };

  const openAddModal = () => {
    setFormData(initialFormData);
    setFormError('');
    setFormSuccess('');
    setIsAddModalOpen(true);
  };

  const handleFormChange = (field: keyof CompanyFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setFormError('');
  };

  // Auto-generate code from name
  const handleNameChange = (name: string) => {
    setFormData(prev => ({
      ...prev,
      name,
      code: name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .substring(0, 20),
    }));
    setFormError('');
  };

  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setFormError('Company name is required');
      return false;
    }
    if (!formData.code.trim()) {
      setFormError('Company code is required');
      return false;
    }
    if (!/^[A-Z0-9_-]+$/.test(formData.code)) {
      setFormError('Company code must contain only uppercase letters, numbers, hyphens, and underscores');
      return false;
    }
    if (!formData.adminEmail.trim()) {
      setFormError('Admin email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.adminEmail)) {
      setFormError('Please enter a valid email address');
      return false;
    }
    if (!formData.adminPassword || formData.adminPassword.length < 6) {
      setFormError('Admin password must be at least 6 characters');
      return false;
    }
    if (!formData.adminFirstName.trim()) {
      setFormError('Admin first name is required');
      return false;
    }
    if (!formData.adminLastName.trim()) {
      setFormError('Admin last name is required');
      return false;
    }
    return true;
  };

  const handleCreateCompany = async () => {
    if (!validateForm()) return;

    setFormLoading(true);
    setFormError('');

    try {
      const payload: CreateCompanyPayload = {
        name: formData.name,
        code: formData.code,
        adminEmail: formData.adminEmail,
        adminPassword: formData.adminPassword,
        adminFirstName: formData.adminFirstName,
        adminLastName: formData.adminLastName,
      };

      await api.post('/companies', payload);
      setFormSuccess('Company created successfully!');
      
      setTimeout(() => {
        setIsAddModalOpen(false);
        loadCompanies();
        loadStats();
      }, 1500);
    } catch (error: any) {
      setFormError(error.message || 'Failed to create company');
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleStatus = async (company: Company) => {
    try {
      await api.put(`/companies/${company.id}/toggle-status`, {});
      loadCompanies();
      loadStats();
    } catch (error: any) {
      console.error('Failed to toggle status:', error);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedCompany) return;

    setFormLoading(true);
    setFormError('');

    try {
      await api.delete(`/companies/${selectedCompany.id}`);
      setIsDeleteModalOpen(false);
      loadCompanies();
      loadStats();
    } catch (error: any) {
      setFormError(error.message || 'Failed to delete company');
    } finally {
      setFormLoading(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Only super admins can access this page
  if (!isSuperAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <Shield className="h-6 w-6 text-red-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-500">
              Only Super Admins can manage companies. Please contact your administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
          <p className="text-gray-500">Manage organizations in the HRMS system</p>
        </div>
        <Button onClick={openAddModal}>
          <Plus className="h-4 w-4 mr-2" />
          Add Company
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Building2 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Companies</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalCompanies}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Power className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Active Companies</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.activeCompanies}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Users className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Employees</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalEmployees}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <UserCheck className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Users</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalUsers}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by company name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: '', label: 'All Status' },
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
              className="w-40"
            />
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
              <TableHead>Employees</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Departments</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingState colSpan={8} />
            ) : companies.length === 0 ? (
              <TableEmptyState 
                message={search || statusFilter ? "No companies match your filters" : "No companies found. Add your first company!"} 
                colSpan={8} 
              />
            ) : (
              companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-5 w-5 text-primary-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {company.name}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                      {company.code}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{company.employeeCount || 0}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{company.userCount || 0}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">{company.departmentCount || 0}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={company.isActive ? 'success' : 'danger'}>
                      {company.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-gray-500">
                      {formatDate(company.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewCompany(company)}
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(company)}
                        title={company.isActive ? 'Deactivate' : 'Activate'}
                        className={company.isActive ? 'text-orange-600 hover:text-orange-700 hover:bg-orange-50' : 'text-green-600 hover:text-green-700 hover:bg-green-50'}
                      >
                        {company.isActive ? (
                          <PowerOff className="h-4 w-4" />
                        ) : (
                          <Power className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteCompany(company)}
                        title="Delete Company"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
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

      {/* Add Company Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add New Company"
        size="xl"
      >
        <div className="max-h-[70vh] overflow-y-auto">
          <FormError message={formError} className="mb-4" />
          <FormSuccess message={formSuccess} className="mb-4" />

          <div className="space-y-6">
            {/* Company Information */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Company Information
              </h4>
              <FormGrid cols={2}>
                <FormRow>
                  <Input
                    label="Company Name *"
                    value={formData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Acme Corporation"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Company Code *"
                    value={formData.code}
                    onChange={(e) => handleFormChange('code', e.target.value.toUpperCase())}
                    placeholder="ACME_CORP"
                    className="font-mono"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Unique identifier. Use uppercase letters, numbers, hyphens, or underscores.
                  </p>
                </FormRow>
              </FormGrid>
            </div>

            {/* Initial Admin User */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                <User className="h-4 w-4" />
                Initial Admin User
              </h4>
              <p className="text-sm text-gray-500 mb-3">
                This user will be created as the HR Admin for the new company and can manage employees, departments, etc.
              </p>
              <FormGrid cols={2}>
                <FormRow>
                  <Input
                    label="First Name *"
                    value={formData.adminFirstName}
                    onChange={(e) => handleFormChange('adminFirstName', e.target.value)}
                    placeholder="John"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Last Name *"
                    value={formData.adminLastName}
                    onChange={(e) => handleFormChange('adminLastName', e.target.value)}
                    placeholder="Doe"
                  />
                </FormRow>
                <FormRow>
                  <div className="relative">
                    <Mail className="absolute left-3 top-9 h-4 w-4 text-gray-400" />
                    <Input
                      label="Email Address *"
                      type="email"
                      value={formData.adminEmail}
                      onChange={(e) => handleFormChange('adminEmail', e.target.value)}
                      placeholder="admin@company.com"
                      className="pl-10"
                    />
                  </div>
                </FormRow>
                <FormRow>
                  <div className="relative">
                    <Key className="absolute left-3 top-9 h-4 w-4 text-gray-400" />
                    <Input
                      label="Password *"
                      type="password"
                      value={formData.adminPassword}
                      onChange={(e) => handleFormChange('adminPassword', e.target.value)}
                      placeholder="••••••••"
                      className="pl-10"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Minimum 6 characters
                  </p>
                </FormRow>
              </FormGrid>
            </div>

            {/* Info box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h5 className="text-sm font-medium text-blue-900 mb-2">What gets created:</h5>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• A new isolated company/tenant</li>
                <li>• HR Admin user account for company management</li>
                <li>• Default leave types (Annual, Sick, Casual)</li>
                <li>• Default overtime rules</li>
              </ul>
            </div>
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreateCompany} disabled={formLoading}>
            {formLoading ? 'Creating...' : 'Create Company'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* View Company Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        title="Company Details"
        size="lg"
      >
        {selectedCompany && (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start gap-4 pb-4 border-b">
              <div className="h-16 w-16 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-8 w-8 text-primary-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900">
                  {selectedCompany.name}
                </h3>
                <div className="flex items-center gap-2 mt-2">
                  <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                    {selectedCompany.code}
                  </span>
                  <Badge variant={selectedCompany.isActive ? 'success' : 'danger'}>
                    {selectedCompany.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Statistics */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Statistics</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-gray-900">{selectedCompany.employeeCount || 0}</p>
                  <p className="text-xs text-gray-500">Total Employees</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-green-600">{selectedCompany.activeEmployeeCount || 0}</p>
                  <p className="text-xs text-gray-500">Active Employees</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-gray-900">{selectedCompany.userCount || 0}</p>
                  <p className="text-xs text-gray-500">Users</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-gray-900">{selectedCompany.departmentCount || 0}</p>
                  <p className="text-xs text-gray-500">Departments</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-gray-900">{selectedCompany.leaveTypeCount || 0}</p>
                  <p className="text-xs text-gray-500">Leave Types</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg text-center">
                  <p className="text-2xl font-bold text-gray-900">{selectedCompany.otRuleCount || 0}</p>
                  <p className="text-xs text-gray-500">OT Rules</p>
                </div>
              </div>
            </div>

            {/* Dates */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Timeline</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Created On</p>
                  <p className="text-sm font-medium">{formatDate(selectedCompany.createdAt)}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Last Updated</p>
                  <p className="text-sm font-medium">{formatDate(selectedCompany.updatedAt)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsViewModalOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Company"
        size="sm"
      >
        <div className="space-y-4">
          <FormError message={formError} />
          <div className="text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <Trash2 className="h-6 w-6 text-red-600" />
            </div>
            <p className="text-gray-900 font-medium">
              Are you sure you want to delete this company?
            </p>
            {selectedCompany && (
              <p className="text-gray-500 mt-1">
                {selectedCompany.name} ({selectedCompany.code})
              </p>
            )}
            <p className="text-sm text-gray-400 mt-2">
              Companies with existing employees cannot be deleted. Deactivate them instead.
            </p>
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsDeleteModalOpen(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleConfirmDelete} 
            disabled={formLoading}
            className="bg-red-600 hover:bg-red-700"
          >
            {formLoading ? 'Deleting...' : 'Delete Company'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
