'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Card, CardHeader, CardTitle, CardContent,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyState, TableLoadingState,
  Badge, getStatusBadgeVariant, Select, Input, Button,
  Modal, ModalFooter, FormRow, FormGrid, FormError, FormSuccess
} from '@/components/ui';
import { Search, Plus, Eye, Edit2, Trash2, UserPlus, Phone, Mail, Calendar, Building2, Users, Download, Filter, X, ChevronDown, ChevronUp } from 'lucide-react';
import { employeesApi, departmentsApi } from '@/lib/api';
import { Employee, Department, EmploymentType, EmployeeStatus, PayType, PaginatedResponse, UserRole } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

// Types for form data
interface EmployeeFormData {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentType: EmploymentType;
  payType: PayType;
  hourlyRate: string;
  otMultiplier: string;
  departmentId: string;
  designation: string;
  managerId: string;
  joinDate: string;
  exitDate: string;
  status: EmployeeStatus;
}

const initialFormData: EmployeeFormData = {
  employeeCode: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  employmentType: EmploymentType.PERMANENT,
  payType: PayType.MONTHLY,
  hourlyRate: '',
  otMultiplier: '1.5',
  departmentId: '',
  designation: '',
  managerId: '',
  joinDate: new Date().toISOString().split('T')[0],
  exitDate: '',
  status: EmployeeStatus.ACTIVE,
};

export default function EmployeesPage() {
  const router = useRouter();
  const { isAdmin, user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]); // For manager dropdown
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  
  // Filters
  const [search, setSearch] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedEmploymentType, setSelectedEmploymentType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Modal states
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  
  // Form state
  const [formData, setFormData] = useState<EmployeeFormData>(initialFormData);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Expanded row for quick view
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadDepartments();
    loadAllEmployees();
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [page, selectedDepartment, selectedEmploymentType, selectedStatus]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (page === 1) {
        loadEmployees();
      } else {
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadDepartments = async () => {
    try {
      const response = await departmentsApi.getAll();
      setDepartments(response.data || []);
    } catch (error) {
      console.error('Failed to load departments:', error);
    }
  };

  const loadAllEmployees = async () => {
    try {
      const response = await employeesApi.getAll({ limit: 1000 });
      setAllEmployees(response.data.data || []);
    } catch (error) {
      console.error('Failed to load all employees:', error);
    }
  };

  const loadEmployees = async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = {
        page,
        limit,
      };
      
      if (search) params.search = search;
      if (selectedDepartment) params.departmentId = selectedDepartment;
      if (selectedEmploymentType) params.employmentType = selectedEmploymentType;
      if (selectedStatus) params.status = selectedStatus;

      const response = await employeesApi.getAll(params);
      const data = response.data;
      setEmployees(data.data || []);
      // Handle both meta object and flat structure
      setTotal(data.meta?.total ?? data.total ?? 0);
    } catch (error) {
      console.error('Failed to load employees:', error);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsViewModalOpen(true);
  };

  const handleEditEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setFormData({
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      phone: employee.phone || '',
      employmentType: employee.employmentType,
      payType: employee.payType,
      hourlyRate: employee.hourlyRate?.toString() || '',
      otMultiplier: employee.otMultiplier?.toString() || '1.5',
      departmentId: employee.departmentId || '',
      designation: employee.designation || '',
      managerId: employee.managerId || '',
      joinDate: employee.joinDate?.split('T')[0] || '',
      exitDate: employee.exitDate?.split('T')[0] || '',
      status: employee.status,
    });
    setFormError('');
    setFormSuccess('');
    setIsEditModalOpen(true);
  };

  const handleDeleteEmployee = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsDeleteModalOpen(true);
  };

  const openAddModal = () => {
    setFormData(initialFormData);
    setFormError('');
    setFormSuccess('');
    setIsAddModalOpen(true);
  };

  const handleFormChange = (field: keyof EmployeeFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setFormError('');
  };

  const validateForm = (): boolean => {
    if (!formData.employeeCode.trim()) {
      setFormError('Employee code is required');
      return false;
    }
    if (!formData.firstName.trim()) {
      setFormError('First name is required');
      return false;
    }
    if (!formData.lastName.trim()) {
      setFormError('Last name is required');
      return false;
    }
    if (!formData.email.trim()) {
      setFormError('Email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setFormError('Please enter a valid email address');
      return false;
    }
    if (!formData.joinDate) {
      setFormError('Join date is required');
      return false;
    }
    if (formData.exitDate && formData.exitDate < formData.joinDate) {
      setFormError('Exit date must be after join date');
      return false;
    }
    if (formData.hourlyRate && parseFloat(formData.hourlyRate) < 0) {
      setFormError('Hourly rate cannot be negative');
      return false;
    }
    if (formData.otMultiplier && parseFloat(formData.otMultiplier) < 0) {
      setFormError('OT multiplier cannot be negative');
      return false;
    }
    return true;
  };

  const handleCreateEmployee = async () => {
    if (!validateForm()) return;

    setFormLoading(true);
    setFormError('');

    try {
      const payload = {
        employeeCode: formData.employeeCode,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone || undefined,
        employmentType: formData.employmentType,
        payType: formData.payType,
        hourlyRate: formData.hourlyRate ? parseFloat(formData.hourlyRate) : undefined,
        otMultiplier: formData.otMultiplier ? parseFloat(formData.otMultiplier) : 1.5,
        departmentId: formData.departmentId || undefined,
        designation: formData.designation || undefined,
        managerId: formData.managerId || undefined,
        joinDate: formData.joinDate,
        exitDate: formData.exitDate || undefined,
        status: formData.status,
      };

      await employeesApi.create(payload);
      setFormSuccess('Employee created successfully!');
      
      setTimeout(() => {
        setIsAddModalOpen(false);
        loadEmployees();
        loadAllEmployees();
      }, 1500);
    } catch (error: any) {
      setFormError(error.message || 'Failed to create employee');
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateEmployee = async () => {
    if (!selectedEmployee) return;
    if (!validateForm()) return;

    setFormLoading(true);
    setFormError('');

    try {
      const payload = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone || undefined,
        employmentType: formData.employmentType,
        payType: formData.payType,
        hourlyRate: formData.hourlyRate ? parseFloat(formData.hourlyRate) : undefined,
        otMultiplier: formData.otMultiplier ? parseFloat(formData.otMultiplier) : undefined,
        departmentId: formData.departmentId || undefined,
        designation: formData.designation || undefined,
        managerId: formData.managerId || undefined,
        exitDate: formData.exitDate || undefined,
        status: formData.status,
      };

      await employeesApi.update(selectedEmployee.id, payload);
      setFormSuccess('Employee updated successfully!');
      
      setTimeout(() => {
        setIsEditModalOpen(false);
        loadEmployees();
        loadAllEmployees();
      }, 1500);
    } catch (error: any) {
      setFormError(error.message || 'Failed to update employee');
    } finally {
      setFormLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!selectedEmployee) return;

    setFormLoading(true);
    setFormError('');

    try {
      await employeesApi.delete(selectedEmployee.id);
      setIsDeleteModalOpen(false);
      loadEmployees();
      loadAllEmployees();
    } catch (error: any) {
      setFormError(error.message || 'Failed to delete employee');
    } finally {
      setFormLoading(false);
    }
  };

  const toggleRowExpansion = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedDepartment('');
    setSelectedEmploymentType('');
    setSelectedStatus('');
    setPage(1);
  };

  const hasActiveFilters = search || selectedDepartment || selectedEmploymentType || selectedStatus;

  const employmentTypeOptions = [
    { value: '', label: 'All Types' },
    { value: EmploymentType.PERMANENT, label: 'Permanent' },
    { value: EmploymentType.CONTRACT, label: 'Contract' },
    { value: EmploymentType.TEMPORARY, label: 'Temporary' },
    { value: EmploymentType.INTERN, label: 'Intern' },
  ];

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: EmployeeStatus.ACTIVE, label: 'Active' },
    { value: EmployeeStatus.INACTIVE, label: 'Inactive' },
  ];

  const payTypeOptions = [
    { value: PayType.MONTHLY, label: 'Monthly' },
    { value: PayType.HOURLY, label: 'Hourly' },
  ];

  const totalPages = Math.ceil(total / limit);

  // Format date for display
  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Calculate tenure
  const calculateTenure = (joinDate: string) => {
    const join = new Date(joinDate);
    const now = new Date();
    const years = Math.floor((now.getTime() - join.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    const months = Math.floor(((now.getTime() - join.getTime()) % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000));
    
    if (years > 0) {
      return `${years}y ${months}m`;
    }
    return `${months}m`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500">Manage and view employee information</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button onClick={() => router.push('/employees/new')}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Employees</p>
                <p className="text-2xl font-bold text-gray-900">{total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Users className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Active</p>
                <p className="text-2xl font-bold text-gray-900">
                  {allEmployees.filter(e => e.status === EmployeeStatus.ACTIVE).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Building2 className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Departments</p>
                <p className="text-2xl font-bold text-gray-900">{departments.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Calendar className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">New This Month</p>
                <p className="text-2xl font-bold text-gray-900">
                  {allEmployees.filter(e => {
                    const joinDate = new Date(e.joinDate);
                    const now = new Date();
                    return joinDate.getMonth() === now.getMonth() && 
                           joinDate.getFullYear() === now.getFullYear();
                  }).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by name, email, or employee code..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="secondary" 
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filters
                  {hasActiveFilters && (
                    <span className="ml-2 bg-primary-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                      {[selectedDepartment, selectedEmploymentType, selectedStatus].filter(Boolean).length}
                    </span>
                  )}
                </Button>
                {hasActiveFilters && (
                  <Button variant="ghost" onClick={clearFilters}>
                    <X className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {showFilters && (
              <div className="grid gap-4 md:grid-cols-3 pt-4 border-t">
                <Select
                  label="Department"
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  options={[
                    { value: '', label: 'All Departments' },
                    ...departments.map(dept => ({
                      value: dept.id,
                      label: dept.name,
                    })),
                  ]}
                />
                <Select
                  label="Employment Type"
                  value={selectedEmploymentType}
                  onChange={(e) => setSelectedEmploymentType(e.target.value)}
                  options={employmentTypeOptions}
                />
                <Select
                  label="Status"
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  options={statusOptions}
                />
              </div>
            )}

            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>Showing {employees.length} of {total} employees</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Employees Table */}
      <Card padding="none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Employee</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Tenure</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingState colSpan={9} />
            ) : employees.length === 0 ? (
              <TableEmptyState 
                message={hasActiveFilters ? "No employees match your filters" : "No employees found"} 
                colSpan={9} 
              />
            ) : (
              employees.map((employee) => (
                <React.Fragment key={employee.id}>
                  <TableRow className="cursor-pointer hover:bg-gray-50">
                    <TableCell>
                      <button
                        onClick={() => toggleRowExpansion(employee.id)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        {expandedRows.has(employee.id) ? (
                          <ChevronUp className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-primary-600 font-medium">
                            {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {employee.firstName} {employee.lastName}
                          </p>
                          <p className="text-sm text-gray-500 truncate">{employee.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                        {employee.employeeCode}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{employee.department?.name || '-'}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{employee.designation || '-'}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="gray">
                        {employee.employmentType.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-gray-600">
                        {calculateTenure(employee.joinDate)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(employee.status)}>
                        {employee.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewEmployee(employee);
                          }}
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {isAdmin && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/employees/${employee.id}/edit`);
                              }}
                              title="Edit Employee"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteEmployee(employee);
                              }}
                              title="Delete Employee"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {/* Expanded Row Content */}
                  {expandedRows.has(employee.id) && (
                    <tr className="bg-gray-50">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="grid md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-gray-500 mb-1">Contact Information</p>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Mail className="h-4 w-4 text-gray-400" />
                                <span>{employee.email}</span>
                              </div>
                              {employee.phone && (
                                <div className="flex items-center gap-2">
                                  <Phone className="h-4 w-4 text-gray-400" />
                                  <span>{employee.phone}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-gray-500 mb-1">Employment Details</p>
                            <div className="space-y-1">
                              <p><span className="text-gray-500">Pay Type:</span> {employee.payType}</p>
                              {employee.hourlyRate && (
                                <p><span className="text-gray-500">Hourly Rate:</span> ${employee.hourlyRate}</p>
                              )}
                              <p><span className="text-gray-500">OT Multiplier:</span> {employee.otMultiplier}x</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-gray-500 mb-1">Dates</p>
                            <div className="space-y-1">
                              <p><span className="text-gray-500">Joined:</span> {formatDate(employee.joinDate)}</p>
                              {employee.exitDate && (
                                <p><span className="text-gray-500">Exit:</span> {formatDate(employee.exitDate)}</p>
                              )}
                            </div>
                          </div>
                          <div>
                            <p className="text-gray-500 mb-1">Reporting</p>
                            <div className="space-y-1">
                              {employee.manager ? (
                                <p><span className="text-gray-500">Manager:</span> {employee.manager.firstName} {employee.manager.lastName}</p>
                              ) : (
                                <p className="text-gray-400">No manager assigned</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t">
            <div className="text-sm text-gray-500">
              Page {page} of {totalPages}
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              {/* Page numbers */}
              <div className="hidden md:flex gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={page === pageNum ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                      className="w-8"
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Add Employee Modal */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add New Employee"
        size="xl"
      >
        <div className="max-h-[70vh] overflow-y-auto">
          <FormError message={formError} className="mb-4" />
          <FormSuccess message={formSuccess} className="mb-4" />

          <div className="space-y-6">
            {/* Basic Information */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Basic Information</h4>
              <FormGrid cols={2}>
                <FormRow>
                  <Input
                    label="Employee Code *"
                    value={formData.employeeCode}
                    onChange={(e) => handleFormChange('employeeCode', e.target.value)}
                    placeholder="EMP001"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Email *"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleFormChange('email', e.target.value)}
                    placeholder="employee@company.com"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="First Name *"
                    value={formData.firstName}
                    onChange={(e) => handleFormChange('firstName', e.target.value)}
                    placeholder="John"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Last Name *"
                    value={formData.lastName}
                    onChange={(e) => handleFormChange('lastName', e.target.value)}
                    placeholder="Doe"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Phone"
                    value={formData.phone}
                    onChange={(e) => handleFormChange('phone', e.target.value)}
                    placeholder="+1 234 567 8900"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Designation"
                    value={formData.designation}
                    onChange={(e) => handleFormChange('designation', e.target.value)}
                    placeholder="Software Engineer"
                  />
                </FormRow>
              </FormGrid>
            </div>

            {/* Employment Details */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Employment Details</h4>
              <FormGrid cols={2}>
                <FormRow>
                  <Select
                    label="Department"
                    value={formData.departmentId}
                    onChange={(e) => handleFormChange('departmentId', e.target.value)}
                    options={[
                      { value: '', label: 'Select Department' },
                      ...departments.map(dept => ({
                        value: dept.id,
                        label: dept.name,
                      })),
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Select
                    label="Employment Type"
                    value={formData.employmentType}
                    onChange={(e) => handleFormChange('employmentType', e.target.value as EmploymentType)}
                    options={[
                      { value: EmploymentType.PERMANENT, label: 'Permanent' },
                      { value: EmploymentType.CONTRACT, label: 'Contract' },
                      { value: EmploymentType.TEMPORARY, label: 'Temporary' },
                      { value: EmploymentType.INTERN, label: 'Intern' },
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Select
                    label="Reporting Manager"
                    value={formData.managerId}
                    onChange={(e) => handleFormChange('managerId', e.target.value)}
                    options={[
                      { value: '', label: 'Select Manager' },
                      ...allEmployees
                        .filter(e => e.status === EmployeeStatus.ACTIVE)
                        .map(emp => ({
                          value: emp.id,
                          label: `${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
                        })),
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Select
                    label="Status"
                    value={formData.status}
                    onChange={(e) => handleFormChange('status', e.target.value as EmployeeStatus)}
                    options={[
                      { value: EmployeeStatus.ACTIVE, label: 'Active' },
                      { value: EmployeeStatus.INACTIVE, label: 'Inactive' },
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Join Date *"
                    type="date"
                    value={formData.joinDate}
                    onChange={(e) => handleFormChange('joinDate', e.target.value)}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Exit Date"
                    type="date"
                    value={formData.exitDate}
                    onChange={(e) => handleFormChange('exitDate', e.target.value)}
                  />
                </FormRow>
              </FormGrid>
            </div>

            {/* Compensation */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Compensation</h4>
              <FormGrid cols={3}>
                <FormRow>
                  <Select
                    label="Pay Type"
                    value={formData.payType}
                    onChange={(e) => handleFormChange('payType', e.target.value as PayType)}
                    options={payTypeOptions}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Hourly Rate"
                    type="number"
                    step="0.01"
                    value={formData.hourlyRate}
                    onChange={(e) => handleFormChange('hourlyRate', e.target.value)}
                    placeholder="0.00"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="OT Multiplier"
                    type="number"
                    step="0.1"
                    value={formData.otMultiplier}
                    onChange={(e) => handleFormChange('otMultiplier', e.target.value)}
                    placeholder="1.5"
                  />
                </FormRow>
              </FormGrid>
            </div>
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreateEmployee} disabled={formLoading}>
            {formLoading ? 'Creating...' : 'Create Employee'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Edit Employee Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="Edit Employee"
        size="xl"
      >
        <div className="max-h-[70vh] overflow-y-auto">
          <FormError message={formError} className="mb-4" />
          <FormSuccess message={formSuccess} className="mb-4" />

          <div className="space-y-6">
            {/* Basic Information */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Basic Information</h4>
              <FormGrid cols={2}>
                <FormRow>
                  <Input
                    label="Employee Code"
                    value={formData.employeeCode}
                    disabled
                    className="bg-gray-50"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Email *"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleFormChange('email', e.target.value)}
                    placeholder="employee@company.com"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="First Name *"
                    value={formData.firstName}
                    onChange={(e) => handleFormChange('firstName', e.target.value)}
                    placeholder="John"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Last Name *"
                    value={formData.lastName}
                    onChange={(e) => handleFormChange('lastName', e.target.value)}
                    placeholder="Doe"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Phone"
                    value={formData.phone}
                    onChange={(e) => handleFormChange('phone', e.target.value)}
                    placeholder="+1 234 567 8900"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Designation"
                    value={formData.designation}
                    onChange={(e) => handleFormChange('designation', e.target.value)}
                    placeholder="Software Engineer"
                  />
                </FormRow>
              </FormGrid>
            </div>

            {/* Employment Details */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Employment Details</h4>
              <FormGrid cols={2}>
                <FormRow>
                  <Select
                    label="Department"
                    value={formData.departmentId}
                    onChange={(e) => handleFormChange('departmentId', e.target.value)}
                    options={[
                      { value: '', label: 'Select Department' },
                      ...departments.map(dept => ({
                        value: dept.id,
                        label: dept.name,
                      })),
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Select
                    label="Employment Type"
                    value={formData.employmentType}
                    onChange={(e) => handleFormChange('employmentType', e.target.value as EmploymentType)}
                    options={[
                      { value: EmploymentType.PERMANENT, label: 'Permanent' },
                      { value: EmploymentType.CONTRACT, label: 'Contract' },
                      { value: EmploymentType.TEMPORARY, label: 'Temporary' },
                      { value: EmploymentType.INTERN, label: 'Intern' },
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Select
                    label="Reporting Manager"
                    value={formData.managerId}
                    onChange={(e) => handleFormChange('managerId', e.target.value)}
                    options={[
                      { value: '', label: 'Select Manager' },
                      ...allEmployees
                        .filter(e => e.status === EmployeeStatus.ACTIVE && e.id !== selectedEmployee?.id)
                        .map(emp => ({
                          value: emp.id,
                          label: `${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
                        })),
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Select
                    label="Status"
                    value={formData.status}
                    onChange={(e) => handleFormChange('status', e.target.value as EmployeeStatus)}
                    options={[
                      { value: EmployeeStatus.ACTIVE, label: 'Active' },
                      { value: EmployeeStatus.INACTIVE, label: 'Inactive' },
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Join Date"
                    type="date"
                    value={formData.joinDate}
                    disabled
                    className="bg-gray-50"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Exit Date"
                    type="date"
                    value={formData.exitDate}
                    onChange={(e) => handleFormChange('exitDate', e.target.value)}
                  />
                </FormRow>
              </FormGrid>
            </div>

            {/* Compensation */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Compensation</h4>
              <FormGrid cols={3}>
                <FormRow>
                  <Select
                    label="Pay Type"
                    value={formData.payType}
                    onChange={(e) => handleFormChange('payType', e.target.value as PayType)}
                    options={payTypeOptions}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Hourly Rate"
                    type="number"
                    step="0.01"
                    value={formData.hourlyRate}
                    onChange={(e) => handleFormChange('hourlyRate', e.target.value)}
                    placeholder="0.00"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="OT Multiplier"
                    type="number"
                    step="0.1"
                    value={formData.otMultiplier}
                    onChange={(e) => handleFormChange('otMultiplier', e.target.value)}
                    placeholder="1.5"
                  />
                </FormRow>
              </FormGrid>
            </div>
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpdateEmployee} disabled={formLoading}>
            {formLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* View Employee Modal */}
      <Modal
        isOpen={isViewModalOpen}
        onClose={() => setIsViewModalOpen(false)}
        title="Employee Details"
        size="xl"
      >
        {selectedEmployee && (
          <div className="space-y-6">
            {/* Header with Avatar */}
            <div className="flex items-start gap-4 pb-4 border-b">
              <div className="h-16 w-16 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                <span className="text-primary-600 text-xl font-semibold">
                  {selectedEmployee.firstName.charAt(0)}{selectedEmployee.lastName.charAt(0)}
                </span>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900">
                  {selectedEmployee.firstName} {selectedEmployee.lastName}
                </h3>
                <p className="text-gray-500">{selectedEmployee.designation || 'No designation'}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="gray">{selectedEmployee.employeeCode}</Badge>
                  <Badge variant={getStatusBadgeVariant(selectedEmployee.status)}>
                    {selectedEmployee.status}
                  </Badge>
                </div>
              </div>
              {isAdmin && (
                <Button variant="secondary" onClick={() => {
                  setIsViewModalOpen(false);
                  handleEditEmployee(selectedEmployee);
                }}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
            </div>

            {/* Contact Information */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Contact Information</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <Mail className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">Email</p>
                    <p className="text-sm font-medium">{selectedEmployee.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <Phone className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-xs text-gray-500">Phone</p>
                    <p className="text-sm font-medium">{selectedEmployee.phone || '-'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Employment Details */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Employment Details</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Department</p>
                  <p className="text-sm font-medium">{selectedEmployee.department?.name || '-'}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Employment Type</p>
                  <p className="text-sm font-medium">{selectedEmployee.employmentType.replace('_', ' ')}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Reporting Manager</p>
                  <p className="text-sm font-medium">
                    {selectedEmployee.manager 
                      ? `${selectedEmployee.manager.firstName} ${selectedEmployee.manager.lastName}`
                      : '-'}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Tenure</p>
                  <p className="text-sm font-medium">{calculateTenure(selectedEmployee.joinDate)}</p>
                </div>
              </div>
            </div>

            {/* Dates */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Important Dates</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Join Date</p>
                  <p className="text-sm font-medium">{formatDate(selectedEmployee.joinDate)}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Exit Date</p>
                  <p className="text-sm font-medium">{formatDate(selectedEmployee.exitDate)}</p>
                </div>
              </div>
            </div>

            {/* Compensation */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-3">Compensation</h4>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Pay Type</p>
                  <p className="text-sm font-medium">{selectedEmployee.payType}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">Hourly Rate</p>
                  <p className="text-sm font-medium">
                    {selectedEmployee.hourlyRate ? `$${selectedEmployee.hourlyRate}` : '-'}
                  </p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">OT Multiplier</p>
                  <p className="text-sm font-medium">{selectedEmployee.otMultiplier}x</p>
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
        title="Delete Employee"
        size="sm"
      >
        <div className="space-y-4">
          <FormError message={formError} />
          <div className="text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <Trash2 className="h-6 w-6 text-red-600" />
            </div>
            <p className="text-gray-900 font-medium">
              Are you sure you want to delete this employee?
            </p>
            {selectedEmployee && (
              <p className="text-gray-500 mt-1">
                {selectedEmployee.firstName} {selectedEmployee.lastName} ({selectedEmployee.employeeCode})
              </p>
            )}
            <p className="text-sm text-gray-400 mt-2">
              This action cannot be undone.
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
            {formLoading ? 'Deleting...' : 'Delete Employee'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
