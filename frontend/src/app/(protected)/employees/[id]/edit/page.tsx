'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { 
  Card, CardContent,
  Button, Input, Select, FormRow, FormGrid, FormError, FormSuccess, Spinner
} from '@/components/ui';
import { 
  ArrowLeft, ArrowRight, Save, CheckCircle2, User, Briefcase, 
  DollarSign, FileText, Users
} from 'lucide-react';
import { employeesApi, departmentsApi } from '@/lib/api';
import { Department, Employee, EmploymentType, EmployeeStatus, PayType } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

interface EmployeeFormData {
  // Personal Information
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  nationality: string;
  
  // Address
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  
  // Employment Details
  employmentType: EmploymentType;
  departmentId: string;
  designation: string;
  managerId: string;
  joinDate: string;
  probationEndDate: string;
  confirmationDate: string;
  status: EmployeeStatus;
  
  // Compensation
  payType: PayType;
  hourlyRate: string;
  monthlySalary: string;
  currency: string;
  otMultiplier: string;
  
  // Emergency Contact
  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactPhone: string;
  emergencyContactEmail: string;
  
  // Additional Info
  bloodGroup: string;
  notes: string;
}

const steps = [
  { id: 1, name: 'Personal Info', icon: User },
  { id: 2, name: 'Employment', icon: Briefcase },
  { id: 3, name: 'Compensation', icon: DollarSign },
  { id: 4, name: 'Additional', icon: FileText },
  { id: 5, name: 'Review', icon: CheckCircle2 },
];

export default function EditEmployeePage() {
  const router = useRouter();
  const params = useParams();
  const employeeId = params.id as string;
  const { isAdmin } = useAuth();
  
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<EmployeeFormData | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [managers, setManagers] = useState<Employee[]>([]);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isAdmin) {
      router.push('/employees');
      return;
    }
    loadEmployee();
    loadDepartments();
    loadManagers();
  }, [isAdmin, employeeId]);

  const loadEmployee = async () => {
    try {
      const response = await employeesApi.getById(employeeId);
      const employee = response.data;
      
      setFormData({
        employeeCode: employee.employeeCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
        email: employee.email,
        phone: employee.phone || '',
        dateOfBirth: '',
        gender: '',
        maritalStatus: '',
        nationality: '',
        address: '',
        city: '',
        state: '',
        zipCode: '',
        country: '',
        employmentType: employee.employmentType,
        departmentId: employee.departmentId || '',
        designation: employee.designation || '',
        managerId: employee.managerId || '',
        joinDate: employee.joinDate ? new Date(employee.joinDate).toISOString().split('T')[0] : '',
        probationEndDate: '',
        confirmationDate: '',
        status: employee.status,
        payType: employee.payType,
        hourlyRate: employee.hourlyRate?.toString() || '',
        monthlySalary: '',
        currency: 'USD',
        otMultiplier: employee.otMultiplier?.toString() || '1.5',
        emergencyContactName: '',
        emergencyContactRelation: '',
        emergencyContactPhone: '',
        emergencyContactEmail: '',
        bloodGroup: '',
        notes: '',
      });
      
      setIsLoading(false);
    } catch (error: any) {
      setFormError(error.message || 'Failed to load employee');
      setIsLoading(false);
    }
  };

  const loadDepartments = async () => {
    try {
      const response = await departmentsApi.getAll();
      setDepartments(response.data || []);
    } catch (error) {
      console.error('Failed to load departments:', error);
    }
  };

  const loadManagers = async () => {
    try {
      const response = await employeesApi.getAll({ limit: 1000 });
      setManagers(response.data.data || []);
    } catch (error) {
      console.error('Failed to load managers:', error);
    }
  };

  const handleInputChange = (field: keyof EmployeeFormData, value: string) => {
    if (!formData) return;
    setFormData(prev => prev ? { ...prev, [field]: value } : null);
    setValidationErrors(prev => ({ ...prev, [field]: '' }));
    setFormError('');
  };

  const validateStep = (step: number): boolean => {
    if (!formData) return false;
    const errors: Record<string, string> = {};

    if (step === 1) {
      if (!formData.firstName.trim()) errors.firstName = 'First name is required';
      if (!formData.lastName.trim()) errors.lastName = 'Last name is required';
      if (!formData.email.trim()) errors.email = 'Email is required';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
        errors.email = 'Invalid email format';
      }
      if (!formData.phone.trim()) errors.phone = 'Phone is required';
    }

    if (step === 2) {
      if (!formData.designation.trim()) errors.designation = 'Designation is required';
      if (!formData.joinDate) errors.joinDate = 'Join date is required';
    }

    if (step === 3) {
      if (formData.payType === PayType.HOURLY && !formData.hourlyRate) {
        errors.hourlyRate = 'Hourly rate is required';
      }
      if (formData.payType === PayType.MONTHLY && !formData.monthlySalary) {
        errors.monthlySalary = 'Monthly salary is required';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, steps.length));
    }
  };

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!formData || !validateStep(currentStep)) return;

    setIsSaving(true);
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
        otMultiplier: formData.otMultiplier ? parseFloat(formData.otMultiplier) : 1.5,
        departmentId: formData.departmentId || undefined,
        designation: formData.designation || undefined,
        managerId: formData.managerId || undefined,
        status: formData.status,
      };

      await employeesApi.update(employeeId, payload);
      setFormSuccess('Employee updated successfully!');
      
      setTimeout(() => {
        router.push('/employees');
      }, 1500);
    } catch (error: any) {
      setFormError(error.message || 'Failed to update employee');
    } finally {
      setIsSaving(false);
    }
  };

  const renderStepContent = () => {
    if (!formData) return null;

    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <User className="h-5 w-5 text-primary-600" />
                Personal Information
              </h3>
              <FormGrid cols={2}>
                <FormRow>
                  <Input
                    label="First Name *"
                    value={formData.firstName}
                    onChange={(e) => handleInputChange('firstName', e.target.value)}
                    placeholder="John"
                    error={validationErrors.firstName}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Last Name *"
                    value={formData.lastName}
                    onChange={(e) => handleInputChange('lastName', e.target.value)}
                    placeholder="Doe"
                    error={validationErrors.lastName}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Email Address *"
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    placeholder="john.doe@company.com"
                    error={validationErrors.email}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Phone Number *"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    placeholder="+1 (555) 123-4567"
                    error={validationErrors.phone}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Date of Birth"
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                  />
                </FormRow>
                <FormRow>
                  <Select
                    label="Gender"
                    value={formData.gender}
                    onChange={(e) => handleInputChange('gender', e.target.value)}
                    options={[
                      { value: '', label: 'Select Gender' },
                      { value: 'male', label: 'Male' },
                      { value: 'female', label: 'Female' },
                      { value: 'other', label: 'Other' },
                      { value: 'prefer_not_to_say', label: 'Prefer not to say' },
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Select
                    label="Marital Status"
                    value={formData.maritalStatus}
                    onChange={(e) => handleInputChange('maritalStatus', e.target.value)}
                    options={[
                      { value: '', label: 'Select Status' },
                      { value: 'single', label: 'Single' },
                      { value: 'married', label: 'Married' },
                      { value: 'divorced', label: 'Divorced' },
                      { value: 'widowed', label: 'Widowed' },
                    ]}
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Nationality"
                    value={formData.nationality}
                    onChange={(e) => handleInputChange('nationality', e.target.value)}
                    placeholder="American"
                  />
                </FormRow>
              </FormGrid>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Address Information</h3>
              <FormGrid cols={1}>
                <FormRow>
                  <Input
                    label="Street Address"
                    value={formData.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    placeholder="123 Main Street, Apt 4B"
                  />
                </FormRow>
              </FormGrid>
              <FormGrid cols={2}>
                <FormRow>
                  <Input
                    label="City"
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    placeholder="New York"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="State/Province"
                    value={formData.state}
                    onChange={(e) => handleInputChange('state', e.target.value)}
                    placeholder="NY"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="ZIP/Postal Code"
                    value={formData.zipCode}
                    onChange={(e) => handleInputChange('zipCode', e.target.value)}
                    placeholder="10001"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Country"
                    value={formData.country}
                    onChange={(e) => handleInputChange('country', e.target.value)}
                    placeholder="United States"
                  />
                </FormRow>
              </FormGrid>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary-600" />
              Employment Details
            </h3>
            <FormGrid cols={2}>
              <FormRow>
                <Input
                  label="Employee Code"
                  value={formData.employeeCode}
                  disabled
                  className="font-mono bg-gray-50"
                />
              </FormRow>
              <FormRow>
                <Input
                  label="Designation/Job Title *"
                  value={formData.designation}
                  onChange={(e) => handleInputChange('designation', e.target.value)}
                  placeholder="Software Engineer"
                  error={validationErrors.designation}
                />
              </FormRow>
              <FormRow>
                <Select
                  label="Department"
                  value={formData.departmentId}
                  onChange={(e) => handleInputChange('departmentId', e.target.value)}
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
                  label="Reporting Manager"
                  value={formData.managerId}
                  onChange={(e) => handleInputChange('managerId', e.target.value)}
                  options={[
                    { value: '', label: 'Select Manager' },
                    ...managers
                      .filter(e => e.status === EmployeeStatus.ACTIVE && e.id !== employeeId)
                      .map(emp => ({
                        value: emp.id,
                        label: `${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
                      })),
                  ]}
                />
              </FormRow>
              <FormRow>
                <Select
                  label="Employment Type"
                  value={formData.employmentType}
                  onChange={(e) => handleInputChange('employmentType', e.target.value as EmploymentType)}
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
                  label="Employment Status"
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value as EmployeeStatus)}
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
                  label="Probation End Date"
                  type="date"
                  value={formData.probationEndDate}
                  onChange={(e) => handleInputChange('probationEndDate', e.target.value)}
                />
              </FormRow>
              <FormRow>
                <Input
                  label="Confirmation Date"
                  type="date"
                  value={formData.confirmationDate}
                  onChange={(e) => handleInputChange('confirmationDate', e.target.value)}
                />
              </FormRow>
            </FormGrid>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary-600" />
              Compensation Details
            </h3>
            <FormGrid cols={2}>
              <FormRow>
                <Select
                  label="Pay Type"
                  value={formData.payType}
                  onChange={(e) => handleInputChange('payType', e.target.value as PayType)}
                  options={[
                    { value: PayType.MONTHLY, label: 'Monthly Salary' },
                    { value: PayType.HOURLY, label: 'Hourly Rate' },
                  ]}
                />
              </FormRow>
              <FormRow>
                <Select
                  label="Currency"
                  value={formData.currency}
                  onChange={(e) => handleInputChange('currency', e.target.value)}
                  options={[
                    { value: 'USD', label: 'USD - US Dollar' },
                    { value: 'EUR', label: 'EUR - Euro' },
                    { value: 'GBP', label: 'GBP - British Pound' },
                    { value: 'INR', label: 'INR - Indian Rupee' },
                    { value: 'CAD', label: 'CAD - Canadian Dollar' },
                  ]}
                />
              </FormRow>
              {formData.payType === PayType.MONTHLY && (
                <FormRow>
                  <Input
                    label="Monthly Salary *"
                    type="number"
                    step="0.01"
                    value={formData.monthlySalary}
                    onChange={(e) => handleInputChange('monthlySalary', e.target.value)}
                    placeholder="5000.00"
                    error={validationErrors.monthlySalary}
                  />
                </FormRow>
              )}
              {formData.payType === PayType.HOURLY && (
                <FormRow>
                  <Input
                    label="Hourly Rate *"
                    type="number"
                    step="0.01"
                    value={formData.hourlyRate}
                    onChange={(e) => handleInputChange('hourlyRate', e.target.value)}
                    placeholder="25.00"
                    error={validationErrors.hourlyRate}
                  />
                </FormRow>
              )}
              <FormRow>
                <Input
                  label="Overtime Multiplier"
                  type="number"
                  step="0.1"
                  value={formData.otMultiplier}
                  onChange={(e) => handleInputChange('otMultiplier', e.target.value)}
                  placeholder="1.5"
                />
              </FormRow>
            </FormGrid>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> Compensation information is confidential and will only be visible to authorized HR administrators.
              </p>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Users className="h-5 w-5 text-primary-600" />
                Emergency Contact
              </h3>
              <FormGrid cols={2}>
                <FormRow>
                  <Input
                    label="Contact Name"
                    value={formData.emergencyContactName}
                    onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
                    placeholder="Jane Doe"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Relationship"
                    value={formData.emergencyContactRelation}
                    onChange={(e) => handleInputChange('emergencyContactRelation', e.target.value)}
                    placeholder="Spouse / Parent / Sibling"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Phone Number"
                    value={formData.emergencyContactPhone}
                    onChange={(e) => handleInputChange('emergencyContactPhone', e.target.value)}
                    placeholder="+1 (555) 987-6543"
                  />
                </FormRow>
                <FormRow>
                  <Input
                    label="Email Address"
                    type="email"
                    value={formData.emergencyContactEmail}
                    onChange={(e) => handleInputChange('emergencyContactEmail', e.target.value)}
                    placeholder="emergency@email.com"
                  />
                </FormRow>
              </FormGrid>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Additional Information</h3>
              <FormGrid cols={2}>
                <FormRow>
                  <Select
                    label="Blood Group"
                    value={formData.bloodGroup}
                    onChange={(e) => handleInputChange('bloodGroup', e.target.value)}
                    options={[
                      { value: '', label: 'Select Blood Group' },
                      { value: 'A+', label: 'A+' },
                      { value: 'A-', label: 'A-' },
                      { value: 'B+', label: 'B+' },
                      { value: 'B-', label: 'B-' },
                      { value: 'AB+', label: 'AB+' },
                      { value: 'AB-', label: 'AB-' },
                      { value: 'O+', label: 'O+' },
                      { value: 'O-', label: 'O-' },
                    ]}
                  />
                </FormRow>
              </FormGrid>
              <FormRow>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  placeholder="Any additional information or notes..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </FormRow>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary-600" />
              Review Employee Information
            </h3>

            {/* Personal Info Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-gray-900">Personal Information</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Name:</span>
                  <p className="font-medium">{formData.firstName} {formData.lastName}</p>
                </div>
                <div>
                  <span className="text-gray-500">Email:</span>
                  <p className="font-medium">{formData.email}</p>
                </div>
                <div>
                  <span className="text-gray-500">Phone:</span>
                  <p className="font-medium">{formData.phone || '-'}</p>
                </div>
                <div>
                  <span className="text-gray-500">Date of Birth:</span>
                  <p className="font-medium">{formData.dateOfBirth || '-'}</p>
                </div>
              </div>
            </div>

            {/* Employment Info Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-gray-900">Employment Details</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Employee Code:</span>
                  <p className="font-medium font-mono">{formData.employeeCode}</p>
                </div>
                <div>
                  <span className="text-gray-500">Designation:</span>
                  <p className="font-medium">{formData.designation}</p>
                </div>
                <div>
                  <span className="text-gray-500">Department:</span>
                  <p className="font-medium">
                    {departments.find(d => d.id === formData.departmentId)?.name || '-'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Employment Type:</span>
                  <p className="font-medium">{formData.employmentType}</p>
                </div>
                <div>
                  <span className="text-gray-500">Status:</span>
                  <p className="font-medium">{formData.status}</p>
                </div>
              </div>
            </div>

            {/* Compensation Summary */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-gray-900">Compensation</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Pay Type:</span>
                  <p className="font-medium">{formData.payType}</p>
                </div>
                <div>
                  <span className="text-gray-500">Amount:</span>
                  <p className="font-medium">
                    {formData.payType === PayType.MONTHLY 
                      ? `${formData.currency} ${formData.monthlySalary || '0'}/month`
                      : `${formData.currency} ${formData.hourlyRate || '0'}/hour`
                    }
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                Please review all information carefully before submitting. You can go back to any step to make changes.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner />
      </div>
    );
  }

  if (!formData) {
    return (
      <div className="max-w-5xl mx-auto">
        <Card>
          <CardContent className="p-6">
            <FormError message="Failed to load employee data" />
            <Button onClick={() => router.push('/employees')} className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Employees
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push('/employees')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Employees
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Edit Employee</h1>
        <p className="text-gray-500">Update employee information - {formData.employeeCode}</p>
      </div>

      {/* Progress Steps */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;

              return (
                <div key={step.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`
                        w-10 h-10 rounded-full flex items-center justify-center transition-colors
                        ${isCompleted ? 'bg-green-500 text-white' : ''}
                        ${isActive ? 'bg-primary-600 text-white' : ''}
                        ${!isActive && !isCompleted ? 'bg-gray-200 text-gray-500' : ''}
                      `}
                    >
                      {isCompleted ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </div>
                    <span
                      className={`
                        mt-2 text-xs font-medium hidden md:block
                        ${isActive ? 'text-primary-600' : 'text-gray-500'}
                      `}
                    >
                      {step.name}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`
                        flex-1 h-0.5 mx-2 transition-colors
                        ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}
                      `}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Form Content */}
      <Card>
        <CardContent className="p-6">
          <FormError message={formError} className="mb-4" />
          <FormSuccess message={formSuccess} className="mb-4" />
          {renderStepContent()}
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              onClick={handlePrevious}
              disabled={currentStep === 1}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Previous
            </Button>

            <div className="text-sm text-gray-500">
              Step {currentStep} of {steps.length}
            </div>

            {currentStep < steps.length ? (
              <Button onClick={handleNext}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? 'Saving...' : 'Update Employee'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
