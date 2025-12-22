'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Card, CardHeader, CardTitle, CardContent,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableEmptyState, TableLoadingState,
  Badge, getStatusBadgeVariant, Select, Input, Button
} from '@/components/ui';
import { Search, Plus, Eye } from 'lucide-react';
import apiClient from '@/lib/api-client';
import { Employee, Department, EmploymentType, PaginatedResponse } from '@/types';

export default function EmployeesPage() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  
  // Filters
  const [search, setSearch] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedEmploymentType, setSelectedEmploymentType] = useState('');

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [page, selectedDepartment, selectedEmploymentType]);

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
      const data = await apiClient.get<Department[]>('/departments');
      setDepartments(data || []);
    } catch (error) {
      console.error('Failed to load departments:', error);
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

      const data = await apiClient.get<PaginatedResponse<Employee>>('/employees', params);
      setEmployees(data.data || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to load employees:', error);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  const handleViewEmployee = (id: string) => {
    router.push(`/employees/${id}`);
  };

  const employmentTypeOptions = [
    { value: '', label: 'All Types' },
    { value: EmploymentType.PERMANENT, label: 'Permanent' },
    { value: EmploymentType.CONTRACT, label: 'Contract' },
    { value: EmploymentType.TEMPORARY, label: 'Temporary' },
    { value: EmploymentType.INTERN, label: 'Intern' },
  ];

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500">Manage and view employee information</p>
        </div>
        <Button onClick={() => router.push('/employees/new')}>
          <Plus className="h-4 w-4 mr-2" />
          Add Employee
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by name, email, or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              placeholder="All Departments"
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
              placeholder="All Types"
              value={selectedEmploymentType}
              onChange={(e) => setSelectedEmploymentType(e.target.value)}
              options={employmentTypeOptions}
            />
            <div className="flex items-center text-sm text-gray-500">
              Showing {employees.length} of {total} employees
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Employees Table */}
      <Card padding="none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableLoadingState colSpan={7} />
            ) : employees.length === 0 ? (
              <TableEmptyState message="No employees found" colSpan={7} />
            ) : (
              employees.map((employee) => (
                <TableRow key={employee.id} onClick={() => handleViewEmployee(employee.id)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-primary-600 font-medium">
                          {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {employee.firstName} {employee.lastName}
                        </p>
                        <p className="text-sm text-gray-500">{employee.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm">{employee.employeeCode}</span>
                  </TableCell>
                  <TableCell>
                    {employee.department?.name || '-'}
                  </TableCell>
                  <TableCell>
                    {employee.designation || '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="gray">
                      {employee.employmentType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(employee.status)}>
                      {employee.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewEmployee(employee.id);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
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
    </div>
  );
}
