'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Card, CardContent,
  Button, Input, Select, FormRow, FormGrid, FormError, FormSuccess
} from '@/components/ui';
import { 
  ArrowLeft, ArrowRight, Save, CheckCircle2, User, Phone, Users,
  GraduationCap, Building2, DollarSign
} from 'lucide-react';
import { employeesApi, departmentsApi } from '@/lib/api';
import { Department, Employee, EmploymentType, EmployeeStatus, PayType } from '@/types';
import { useAuth } from '@/contexts/AuthContext';

interface EmployeeFormData {
  // Personal Information
  salutation: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  gender: string;
  dateOfBirth: string;
  fatherName: string;
  aadhaarNumber: string;
  maritalStatus: string;
  bloodGroup: string;
  joinDate: string;
  status: EmployeeStatus;
  
  // Contact Details
  mobileNumber: string;
  workEmail: string;
  personalEmail: string;
  currentAddress: string;
  currentCity: string;
  currentState: string;
  currentZipCode: string;
  currentCountry: string;
  permanentAddress: string;
  permanentCity: string;
  permanentState: string;
  permanentZipCode: string;
  permanentCountry: string;
  sameAsCurrent: boolean;
  
  // Emergency Contact
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyContactRelation: string;
  
  // Education Details
  highestQualification: string;
  previousWorkExperience: string;
  historyInCompany: string;
  
  // Company Details
  company: string;
  designation: string;
  branch: string;
  departmentId: string;
  reportsTo: string;
  employeeType: EmploymentType;
  
  // Salary
  ctc: string;
  panNumber: string;
  pfa: string;
  accountNumber: string;
  
  // User Account Creation
  createUser: boolean;
  userEmail: string;
  userPassword: string;
  userRole: string;
  
  // Legacy fields for compatibility
  managerId: string;
  payType: PayType;
  hourlyRate: string;
  monthlySalary: string;
  currency: string;
  otMultiplier: string;
}

const initialFormData: EmployeeFormData = {
  // Personal Information
  salutation: '',
  firstName: '',
  lastName: '',
  employeeCode: '',
  gender: '',
  dateOfBirth: '',
  fatherName: '',
  aadhaarNumber: '',
  maritalStatus: '',
  bloodGroup: '',
  joinDate: new Date().toISOString().split('T')[0],
  status: EmployeeStatus.ACTIVE,
  
  // Contact Details
  mobileNumber: '',
  workEmail: '',
  personalEmail: '',
  currentAddress: '',
  currentCity: '',
  currentState: '',
  currentZipCode: '',
  currentCountry: '',
  permanentAddress: '',
  permanentCity: '',
  permanentState: '',
  permanentZipCode: '',
  permanentCountry: '',
  sameAsCurrent: false,
  
  // Emergency Contact
  emergencyContactName: '',
  emergencyContactNumber: '',
  emergencyContactRelation: '',
  
  // Education Details
  highestQualification: '',
  previousWorkExperience: '',
  historyInCompany: '',
  
  // Company Details
  company: '',
  designation: '',
  branch: '',
  departmentId: '',
  reportsTo: '',
  employeeType: EmploymentType.PERMANENT,
  
  // Salary
  ctc: '',
  panNumber: '',
  pfa: '',
  accountNumber: '',
  
  // User Account Creation
  createUser: false,
  userEmail: '',
  userPassword: '',
  userRole: 'EMPLOYEE',
  
  // Legacy fields for compatibility
  managerId: '',
  payType: PayType.MONTHLY,
  hourlyRate: '',
  monthlySalary: '',
  currency: 'INR',
  otMultiplier: '1.5',
};

const steps = [
  { id: 1, name: 'Personal Info', icon: User },
  { id: 2, name: 'Contact Details', icon: Phone },
  { id: 3, name: 'Emergency Contact', icon: Users },
  { id: 4, name: 'Education', icon: GraduationCap },
  { id: 5, name: 'Company Details', icon: Building2 },
  { id: 6, name: 'Salary', icon: DollarSign },
  { id: 7, name: 'Review', icon: CheckCircle2 },
];

export default function NewEmployeePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<EmployeeFormData>(initialFormData);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [managers, setManagers] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchDepartments();
    fetchManagers();
    generateEmployeeCode();
  }, []);

  const fetchDepartments = async () => {
    try {
      const response = await departmentsApi.getAll();
      setDepartments(response.data);
    } catch (err) {
      console.error('Failed to fetch departments:', err);
    }
  };

  const fetchManagers = async () => {
    try {
      const response = await employeesApi.getAll();
      const employees: Employee[] = response.data.data || response.data;
      setManagers(employees.filter((emp: Employee) => emp.id !== formData.managerId));
    } catch (err) {
      console.error('Failed to fetch managers:', err);
    }
  };

  const generateEmployeeCode = async () => {
    try {
      const response = await employeesApi.getAll();
      const employees: Employee[] = response.data.data || response.data;
      const lastEmployee = employees.sort((a: Employee, b: Employee) =>
        parseInt(b.employeeCode.replace(/\D/g, '')) - parseInt(a.employeeCode.replace(/\D/g, ''))
      )[0];
      
      let nextNumber = 1;
      if (lastEmployee) {
        const lastNumber = parseInt(lastEmployee.employeeCode.replace(/\D/g, ''));
        nextNumber = lastNumber + 1;
      }
      
      const newCode = `EMP${String(nextNumber).padStart(3, '0')}`;
      setFormData(prev => ({ ...prev, employeeCode: newCode }));
    } catch (err) {
      console.error('Failed to generate employee code:', err);
    }
  };

  const handleInputChange = (field: keyof EmployeeFormData, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // If "Same as Current" checkbox is checked, copy current address fields
      if (field === 'sameAsCurrent' && value === true) {
        updated.permanentAddress = prev.currentAddress;
        updated.permanentCity = prev.currentCity;
        updated.permanentState = prev.currentState;
        updated.permanentZipCode = prev.currentZipCode;
        updated.permanentCountry = prev.currentCountry;
      }
      
      // If createUser is checked, auto-populate user email with work email
      if (field === 'createUser' && value === true && prev.workEmail) {
        updated.userEmail = prev.workEmail;
      }
      
      return updated;
    });
    setError('');
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1: // Personal Info
        if (!formData.firstName.trim()) {
          setError('First name is required');
          return false;
        }
        if (!formData.lastName.trim()) {
          setError('Last name is required');
          return false;
        }
        if (!formData.employeeCode.trim()) {
          setError('Employee code is required');
          return false;
        }
        if (!formData.dateOfBirth) {
          setError('Date of birth is required');
          return false;
        }
        if (!formData.gender) {
          setError('Gender is required');
          return false;
        }
        break;
        
      case 2: // Contact Details
        if (!formData.mobileNumber.trim()) {
          setError('Mobile number is required');
          return false;
        }
        if (!formData.workEmail.trim()) {
          setError('Work email is required');
          return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.workEmail)) {
          setError('Please enter a valid work email');
          return false;
        }
        if (!formData.currentAddress.trim()) {
          setError('Current address is required');
          return false;
        }
        break;
        
      case 3: // Emergency Contact
        if (!formData.emergencyContactName.trim()) {
          setError('Emergency contact name is required');
          return false;
        }
        if (!formData.emergencyContactNumber.trim()) {
          setError('Emergency contact number is required');
          return false;
        }
        break;
        
      case 4: // Education Details
        if (!formData.highestQualification) {
          setError('Highest qualification is required');
          return false;
        }
        break;
        
      case 5: // Company Details
        if (!formData.designation.trim()) {
          setError('Designation is required');
          return false;
        }
        if (!formData.departmentId) {
          setError('Department is required');
          return false;
        }
        if (!formData.reportsTo) {
          setError('Reports To is required');
          return false;
        }
        break;
        
      case 6: // Salary
        if (!formData.ctc) {
          setError('CTC is required');
          return false;
        }
        if (!formData.panNumber.trim()) {
          setError('PAN number is required');
          return false;
        }
        if (formData.panNumber.length !== 10) {
          setError('PAN number must be 10 characters');
          return false;
        }
        // Validate user account creation fields if enabled
        if (formData.createUser) {
          if (!formData.userEmail.trim()) {
            setError('User email is required when creating user account');
            return false;
          }
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.userEmail)) {
            setError('Please enter a valid user email');
            return false;
          }
          if (!formData.userPassword.trim()) {
            setError('User password is required when creating user account');
            return false;
          }
          if (formData.userPassword.length < 6) {
            setError('User password must be at least 6 characters');
            return false;
          }
          if (!formData.userRole) {
            setError('User role is required when creating user account');
            return false;
          }
        }
        break;
    }
    
    setError('');
    return true;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, steps.length));
    }
  };

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    setError('');
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        salutation: formData.salutation,
        firstName: formData.firstName,
        lastName: formData.lastName,
        employeeCode: formData.employeeCode,
        email: formData.workEmail,
        gender: formData.gender,
        dateOfBirth: formData.dateOfBirth ? new Date(formData.dateOfBirth) : undefined,
        fatherName: formData.fatherName || undefined,
        aadhaarNumber: formData.aadhaarNumber || undefined,
        maritalStatus: formData.maritalStatus || undefined,
        bloodGroup: formData.bloodGroup || undefined,
        joinDate: new Date(formData.joinDate),
        status: formData.status,
        mobileNumber: formData.mobileNumber,
        workEmail: formData.workEmail,
        personalEmail: formData.personalEmail || undefined,
        currentAddress: formData.currentAddress,
        currentCity: formData.currentCity || undefined,
        currentState: formData.currentState || undefined,
        currentZipCode: formData.currentZipCode || undefined,
        currentCountry: formData.currentCountry || undefined,
        permanentAddress: formData.permanentAddress || undefined,
        permanentCity: formData.permanentCity || undefined,
        permanentState: formData.permanentState || undefined,
        permanentZipCode: formData.permanentZipCode || undefined,
        permanentCountry: formData.permanentCountry || undefined,
        emergencyContactName: formData.emergencyContactName,
        emergencyContactNumber: formData.emergencyContactNumber,
        emergencyContactRelation: formData.emergencyContactRelation || undefined,
        employmentType: formData.employeeType,
        payType: PayType.MONTHLY,
        monthlySalary: parseFloat(formData.ctc) || 0,
        hourlyRate: undefined,
        otMultiplier: 1.5,
        departmentId: formData.departmentId || undefined,
        designation: formData.designation || undefined,
        managerId: formData.reportsTo || undefined,
        // User account creation fields
        createUser: formData.createUser,
        userEmail: formData.createUser ? formData.userEmail : undefined,
        userPassword: formData.createUser ? formData.userPassword : undefined,
        userRole: formData.createUser ? formData.userRole : undefined,
      };

      await employeesApi.create(payload);

      const successMessage = formData.createUser 
        ? 'Employee and user account created successfully!' 
        : 'Employee created successfully!';
      setSuccess(successMessage);
      
      setTimeout(() => {
        router.push('/employees');
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create employee');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1: // Personal Info
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <User className="h-5 w-5 text-primary-600" />
              Personal Information
            </h3>
            
            <FormGrid cols={3}>
              <FormRow label="Salutation" required>
                <Select
                  value={formData.salutation}
                  onChange={(e) => handleInputChange('salutation', e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="Mr">Mr.</option>
                  <option value="Ms">Ms.</option>
                  <option value="Mrs">Mrs.</option>
                  <option value="Dr">Dr.</option>
                </Select>
              </FormRow>

              <FormRow label="First Name" required>
                <Input
                  value={formData.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  placeholder="Enter first name"
                />
              </FormRow>

              <FormRow label="Last Name" required>
                <Input
                  value={formData.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  placeholder="Enter last name"
                />
              </FormRow>
            </FormGrid>

            <FormGrid cols={2}>
              <FormRow label="Employee Code" required>
                <Input
                  value={formData.employeeCode}
                  onChange={(e) => handleInputChange('employeeCode', e.target.value)}
                  placeholder="Auto-generated"
                  className="bg-gray-50"
                  readOnly
                />
              </FormRow>

              <FormRow label="Gender" required>
                <Select
                  value={formData.gender}
                  onChange={(e) => handleInputChange('gender', e.target.value)}
                >
                  <option value="">Select Gender</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </Select>
              </FormRow>

              <FormRow label="Date of Birth" required>
                <Input
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                />
              </FormRow>

              <FormRow label="Father's Name">
                <Input
                  value={formData.fatherName}
                  onChange={(e) => handleInputChange('fatherName', e.target.value)}
                  placeholder="Enter father's name"
                />
              </FormRow>

              <FormRow label="Aadhaar Number">
                <Input
                  value={formData.aadhaarNumber}
                  onChange={(e) => handleInputChange('aadhaarNumber', e.target.value)}
                  placeholder="1234 5678 9012"
                  maxLength={12}
                />
              </FormRow>

              <FormRow label="Marital Status">
                <Select
                  value={formData.maritalStatus}
                  onChange={(e) => handleInputChange('maritalStatus', e.target.value)}
                >
                  <option value="">Select Status</option>
                  <option value="SINGLE">Single</option>
                  <option value="MARRIED">Married</option>
                  <option value="DIVORCED">Divorced</option>
                  <option value="WIDOWED">Widowed</option>
                </Select>
              </FormRow>

              <FormRow label="Blood Group">
                <Select
                  value={formData.bloodGroup}
                  onChange={(e) => handleInputChange('bloodGroup', e.target.value)}
                >
                  <option value="">Select Blood Group</option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                </Select>
              </FormRow>

              <FormRow label="Join Date" required>
                <Input
                  type="date"
                  value={formData.joinDate}
                  onChange={(e) => handleInputChange('joinDate', e.target.value)}
                />
              </FormRow>

              <FormRow label="Status" required>
                <Select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value as EmployeeStatus)}
                >
                  <option value={EmployeeStatus.ACTIVE}>Active</option>
                  <option value={EmployeeStatus.INACTIVE}>Inactive</option>
                </Select>
              </FormRow>
            </FormGrid>
          </div>
        );

      case 2: // Contact Details
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Phone className="h-5 w-5 text-primary-600" />
              Contact Details
            </h3>
            
            <FormGrid cols={2}>
              <FormRow label="Mobile Number" required>
                <Input
                  type="tel"
                  value={formData.mobileNumber}
                  onChange={(e) => handleInputChange('mobileNumber', e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </FormRow>

              <FormRow label="Work Email" required>
                <Input
                  type="email"
                  value={formData.workEmail}
                  onChange={(e) => handleInputChange('workEmail', e.target.value)}
                  placeholder="john.doe@company.com"
                />
              </FormRow>

              <FormRow label="Personal Email" colSpan={2}>
                <Input
                  type="email"
                  value={formData.personalEmail}
                  onChange={(e) => handleInputChange('personalEmail', e.target.value)}
                  placeholder="john@personal.com"
                />
              </FormRow>
            </FormGrid>

            <div className="pt-4 border-t">
              <h4 className="text-md font-medium text-gray-800 mb-3">Current Address</h4>
              <FormGrid cols={1}>
                <FormRow label="Address" required>
                  <Input
                    value={formData.currentAddress}
                    onChange={(e) => handleInputChange('currentAddress', e.target.value)}
                    placeholder="Street address"
                  />
                </FormRow>
              </FormGrid>
              
              <FormGrid cols={2}>
                <FormRow label="City">
                  <Input
                    value={formData.currentCity}
                    onChange={(e) => handleInputChange('currentCity', e.target.value)}
                    placeholder="City"
                  />
                </FormRow>

                <FormRow label="State">
                  <Input
                    value={formData.currentState}
                    onChange={(e) => handleInputChange('currentState', e.target.value)}
                    placeholder="State"
                  />
                </FormRow>

                <FormRow label="Zip Code">
                  <Input
                    value={formData.currentZipCode}
                    onChange={(e) => handleInputChange('currentZipCode', e.target.value)}
                    placeholder="123456"
                  />
                </FormRow>

                <FormRow label="Country">
                  <Input
                    value={formData.currentCountry}
                    onChange={(e) => handleInputChange('currentCountry', e.target.value)}
                    placeholder="India"
                  />
                </FormRow>
              </FormGrid>
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-md font-medium text-gray-800">Permanent Address</h4>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.sameAsCurrent}
                    onChange={(e) => handleInputChange('sameAsCurrent', e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  Same as Current Address
                </label>
              </div>
              
              <FormGrid cols={1}>
                <FormRow label="Address">
                  <Input
                    value={formData.permanentAddress}
                    onChange={(e) => handleInputChange('permanentAddress', e.target.value)}
                    placeholder="Street address"
                    disabled={formData.sameAsCurrent}
                  />
                </FormRow>
              </FormGrid>
              
              <FormGrid cols={2}>
                <FormRow label="City">
                  <Input
                    value={formData.permanentCity}
                    onChange={(e) => handleInputChange('permanentCity', e.target.value)}
                    placeholder="City"
                    disabled={formData.sameAsCurrent}
                  />
                </FormRow>

                <FormRow label="State">
                  <Input
                    value={formData.permanentState}
                    onChange={(e) => handleInputChange('permanentState', e.target.value)}
                    placeholder="State"
                    disabled={formData.sameAsCurrent}
                  />
                </FormRow>

                <FormRow label="Zip Code">
                  <Input
                    value={formData.permanentZipCode}
                    onChange={(e) => handleInputChange('permanentZipCode', e.target.value)}
                    placeholder="123456"
                    disabled={formData.sameAsCurrent}
                  />
                </FormRow>

                <FormRow label="Country">
                  <Input
                    value={formData.permanentCountry}
                    onChange={(e) => handleInputChange('permanentCountry', e.target.value)}
                    placeholder="India"
                    disabled={formData.sameAsCurrent}
                  />
                </FormRow>
              </FormGrid>
            </div>
          </div>
        );

      case 3: // Emergency Contact
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-primary-600" />
              Emergency Contact
            </h3>
            
            <FormGrid cols={2}>
              <FormRow label="Contact Name" required>
                <Input
                  value={formData.emergencyContactName}
                  onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
                  placeholder="Enter name"
                />
              </FormRow>

              <FormRow label="Contact Number" required>
                <Input
                  type="tel"
                  value={formData.emergencyContactNumber}
                  onChange={(e) => handleInputChange('emergencyContactNumber', e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </FormRow>

              <FormRow label="Relationship" colSpan={2}>
                <Select
                  value={formData.emergencyContactRelation}
                  onChange={(e) => handleInputChange('emergencyContactRelation', e.target.value)}
                >
                  <option value="">Select Relationship</option>
                  <option value="SPOUSE">Spouse</option>
                  <option value="PARENT">Parent</option>
                  <option value="SIBLING">Sibling</option>
                  <option value="CHILD">Child</option>
                  <option value="FRIEND">Friend</option>
                  <option value="OTHER">Other</option>
                </Select>
              </FormRow>
            </FormGrid>
          </div>
        );

      case 4: // Education Details
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary-600" />
              Education Details
            </h3>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-800">
                Please provide details about the employee's educational background and work experience.
              </p>
            </div>
            
            <FormGrid cols={1}>
              <FormRow label="Highest Qualification" required>
                <Select
                  value={formData.highestQualification}
                  onChange={(e) => handleInputChange('highestQualification', e.target.value)}
                >
                  <option value="">Select Qualification</option>
                  <option value="High School">High School</option>
                  <option value="Diploma">Diploma</option>
                  <option value="Bachelor's Degree">Bachelor's Degree</option>
                  <option value="Master's Degree">Master's Degree</option>
                  <option value="Doctorate">Doctorate (PhD)</option>
                  <option value="Other">Other</option>
                </Select>
              </FormRow>

              <FormRow label="Previous Work Experience">
                <textarea
                  value={formData.previousWorkExperience}
                  onChange={(e) => handleInputChange('previousWorkExperience', e.target.value)}
                  placeholder="Describe previous work experience, roles, and responsibilities..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  rows={4}
                />
              </FormRow>

              <FormRow label="History in Company">
                <textarea
                  value={formData.historyInCompany}
                  onChange={(e) => handleInputChange('historyInCompany', e.target.value)}
                  placeholder="Describe the employee's history and progression in the company..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  rows={4}
                />
              </FormRow>
            </FormGrid>
          </div>
        );

      case 5: // Company Details
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary-600" />
              Company Details
            </h3>
            
            <FormGrid cols={2}>
              <FormRow label="Company">
                <Input
                  value={user?.tenantId || ''}
                  disabled
                  className="bg-gray-50"
                />
              </FormRow>

              <FormRow label="Designation" required>
                <Input
                  value={formData.designation}
                  onChange={(e) => handleInputChange('designation', e.target.value)}
                  placeholder="e.g., Software Engineer, HR Manager"
                />
              </FormRow>

              <FormRow label="Branch">
                <Input
                  value={formData.branch}
                  onChange={(e) => handleInputChange('branch', e.target.value)}
                  placeholder="e.g., Head Office, Mumbai Branch"
                />
              </FormRow>

              <FormRow label="Department" required>
                <Select
                  value={formData.departmentId}
                  onChange={(e) => handleInputChange('departmentId', e.target.value)}
                >
                  <option value="">Select Department</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </Select>
              </FormRow>

              <FormRow label="Reports To" required>
                <Select
                  value={formData.reportsTo}
                  onChange={(e) => handleInputChange('reportsTo', e.target.value)}
                >
                  <option value="">Select Manager</option>
                  {managers.map(manager => (
                    <option key={manager.id} value={manager.id}>
                      {manager.firstName} {manager.lastName} ({manager.employeeCode})
                    </option>
                  ))}
                </Select>
              </FormRow>

              <FormRow label="Employee Type" required>
                <Select
                  value={formData.employeeType}
                  onChange={(e) => handleInputChange('employeeType', e.target.value as EmploymentType)}
                >
                  <option value={EmploymentType.PERMANENT}>Permanent</option>
                  <option value={EmploymentType.CONTRACT}>Contract</option>
                  <option value={EmploymentType.TEMPORARY}>Temporary</option>
                  <option value={EmploymentType.INTERN}>Intern</option>
                </Select>
              </FormRow>
            </FormGrid>
          </div>
        );

      case 6: // Salary
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary-600" />
              Salary Details
            </h3>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-yellow-800">
                ⚠️ Salary information is confidential. Please ensure accuracy.
              </p>
            </div>
            
            <FormGrid cols={2}>
              <FormRow label="CTC (Annual)" required>
                <Input
                  type="number"
                  value={formData.ctc}
                  onChange={(e) => handleInputChange('ctc', e.target.value)}
                  placeholder="e.g., 600000"
                />
              </FormRow>

              <FormRow label="PAN Number" required>
                <Input
                  value={formData.panNumber}
                  onChange={(e) => handleInputChange('panNumber', e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  style={{ textTransform: 'uppercase' }}
                />
              </FormRow>

              <FormRow label="PFA (Provident Fund Account)">
                <Input
                  value={formData.pfa}
                  onChange={(e) => handleInputChange('pfa', e.target.value)}
                  placeholder="Enter PF account number"
                />
              </FormRow>

              <FormRow label="Bank Account Number">
                <Input
                  value={formData.accountNumber}
                  onChange={(e) => handleInputChange('accountNumber', e.target.value)}
                  placeholder="Enter bank account number"
                />
              </FormRow>
            </FormGrid>

            {/* User Account Creation Section */}
            <div className="pt-6 border-t mt-8">
              <h4 className="text-md font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <User className="h-5 w-5 text-primary-600" />
                HRMS User Account
              </h4>
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.createUser}
                    onChange={(e) => handleInputChange('createUser', e.target.checked)}
                    className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-blue-900">
                      Create user profile for HRMS access
                    </span>
                    <p className="text-xs text-blue-700 mt-1">
                      Enable this to create a login account for this employee to access the HRMS system
                    </p>
                  </div>
                </label>
              </div>

              {formData.createUser && (
                <FormGrid cols={2}>
                  <FormRow label="User Email" required>
                    <Input
                      type="email"
                      value={formData.userEmail}
                      onChange={(e) => handleInputChange('userEmail', e.target.value)}
                      placeholder="user@company.com"
                    />
                  </FormRow>

                  <FormRow label="Password" required>
                    <Input
                      type="password"
                      value={formData.userPassword}
                      onChange={(e) => handleInputChange('userPassword', e.target.value)}
                      placeholder="Minimum 6 characters"
                      minLength={6}
                    />
                  </FormRow>

                  <FormRow label="User Role" required colSpan={2}>
                    <Select
                      value={formData.userRole}
                      onChange={(e) => handleInputChange('userRole', e.target.value)}
                    >
                      <option value="EMPLOYEE">Employee</option>
                      <option value="MANAGER">Manager</option>
                      <option value="HR_ADMIN">HR Admin</option>
                      <option value="SUPER_ADMIN">Super Admin</option>
                    </Select>
                  </FormRow>
                </FormGrid>
              )}
            </div>
          </div>
        );

      case 7: // Review
        return (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary-600" />
              Review Employee Details
            </h3>
            
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-green-800">
                Please review all the information before submitting. You can go back to edit any section.
              </p>
            </div>

            {/* Personal Information Summary */}
            <Card>
              <CardContent>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Personal Information
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Name:</span>
                    <span className="ml-2 font-medium">
                      {formData.salutation} {formData.firstName} {formData.lastName}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Employee Code:</span>
                    <span className="ml-2 font-medium">{formData.employeeCode}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Gender:</span>
                    <span className="ml-2 font-medium">{formData.gender}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Date of Birth:</span>
                    <span className="ml-2 font-medium">{formData.dateOfBirth}</span>
                  </div>
                  {formData.fatherName && (
                    <div>
                      <span className="text-gray-600">Father's Name:</span>
                      <span className="ml-2 font-medium">{formData.fatherName}</span>
                    </div>
                  )}
                  {formData.aadhaarNumber && (
                    <div>
                      <span className="text-gray-600">Aadhaar:</span>
                      <span className="ml-2 font-medium">{formData.aadhaarNumber}</span>
                    </div>
                  )}
                  {formData.maritalStatus && (
                    <div>
                      <span className="text-gray-600">Marital Status:</span>
                      <span className="ml-2 font-medium">{formData.maritalStatus}</span>
                    </div>
                  )}
                  {formData.bloodGroup && (
                    <div>
                      <span className="text-gray-600">Blood Group:</span>
                      <span className="ml-2 font-medium">{formData.bloodGroup}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-600">Join Date:</span>
                    <span className="ml-2 font-medium">{formData.joinDate}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Status:</span>
                    <span className="ml-2 font-medium">{formData.status}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Contact Details Summary */}
            <Card>
              <CardContent>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Contact Details
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Mobile:</span>
                    <span className="ml-2 font-medium">{formData.mobileNumber}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Work Email:</span>
                    <span className="ml-2 font-medium">{formData.workEmail}</span>
                  </div>
                  {formData.personalEmail && (
                    <div className="col-span-2">
                      <span className="text-gray-600">Personal Email:</span>
                      <span className="ml-2 font-medium">{formData.personalEmail}</span>
                    </div>
                  )}
                  <div className="col-span-2">
                    <span className="text-gray-600">Current Address:</span>
                    <span className="ml-2 font-medium">
                      {formData.currentAddress}
                      {formData.currentCity && `, ${formData.currentCity}`}
                      {formData.currentState && `, ${formData.currentState}`}
                      {formData.currentZipCode && ` - ${formData.currentZipCode}`}
                      {formData.currentCountry && `, ${formData.currentCountry}`}
                    </span>
                  </div>
                  {formData.permanentAddress && (
                    <div className="col-span-2">
                      <span className="text-gray-600">Permanent Address:</span>
                      <span className="ml-2 font-medium">
                        {formData.permanentAddress}
                        {formData.permanentCity && `, ${formData.permanentCity}`}
                        {formData.permanentState && `, ${formData.permanentState}`}
                        {formData.permanentZipCode && ` - ${formData.permanentZipCode}`}
                        {formData.permanentCountry && `, ${formData.permanentCountry}`}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Emergency Contact Summary */}
            <Card>
              <CardContent>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Emergency Contact
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Name:</span>
                    <span className="ml-2 font-medium">{formData.emergencyContactName}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Number:</span>
                    <span className="ml-2 font-medium">{formData.emergencyContactNumber}</span>
                  </div>
                  {formData.emergencyContactRelation && (
                    <div className="col-span-2">
                      <span className="text-gray-600">Relationship:</span>
                      <span className="ml-2 font-medium">{formData.emergencyContactRelation}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Education Details Summary */}
            <Card>
              <CardContent>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <GraduationCap className="h-4 w-4" />
                  Education Details
                </h4>
                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-gray-600">Highest Qualification:</span>
                    <span className="ml-2 font-medium">{formData.highestQualification}</span>
                  </div>
                  {formData.previousWorkExperience && (
                    <div>
                      <span className="text-gray-600">Previous Work Experience:</span>
                      <p className="mt-1 text-gray-800">{formData.previousWorkExperience}</p>
                    </div>
                  )}
                  {formData.historyInCompany && (
                    <div>
                      <span className="text-gray-600">History in Company:</span>
                      <p className="mt-1 text-gray-800">{formData.historyInCompany}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Company Details Summary */}
            <Card>
              <CardContent>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Company Details
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Designation:</span>
                    <span className="ml-2 font-medium">{formData.designation}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Department:</span>
                    <span className="ml-2 font-medium">
                      {departments.find(d => d.id === formData.departmentId)?.name || 'N/A'}
                    </span>
                  </div>
                  {formData.branch && (
                    <div>
                      <span className="text-gray-600">Branch:</span>
                      <span className="ml-2 font-medium">{formData.branch}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-gray-600">Employee Type:</span>
                    <span className="ml-2 font-medium">{formData.employeeType}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-600">Reports To:</span>
                    <span className="ml-2 font-medium">
                      {managers.find(m => m.id === formData.reportsTo)?.firstName || 'N/A'}{' '}
                      {managers.find(m => m.id === formData.reportsTo)?.lastName || ''}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Salary Details Summary */}
            <Card>
              <CardContent>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Salary Details
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">CTC (Annual):</span>
                    <span className="ml-2 font-medium">
                      ₹ {parseFloat(formData.ctc).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">PAN Number:</span>
                    <span className="ml-2 font-medium">{formData.panNumber}</span>
                  </div>
                  {formData.pfa && (
                    <div>
                      <span className="text-gray-600">PFA:</span>
                      <span className="ml-2 font-medium">{formData.pfa}</span>
                    </div>
                  )}
                  {formData.accountNumber && (
                    <div>
                      <span className="text-gray-600">Account Number:</span>
                      <span className="ml-2 font-medium">{formData.accountNumber}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* User Account Summary */}
            {formData.createUser && (
              <Card>
                <CardContent>
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <User className="h-4 w-4" />
                    HRMS User Account
                  </h4>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
                    <p className="text-sm text-green-800">
                      ✓ User account will be created for HRMS access
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">User Email:</span>
                      <span className="ml-2 font-medium">{formData.userEmail}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">User Role:</span>
                      <span className="ml-2 font-medium">{formData.userRole}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-600">Password:</span>
                      <span className="ml-2 font-medium">••••••••</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={() => router.back()}
            className="text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Add New Employee</h1>
            <p className="text-sm text-gray-600 mt-1">
              Step {currentStep} of {steps.length}: {steps[currentStep - 1].name}
            </p>
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="flex items-center gap-2">
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = currentStep === step.id;
            const isCompleted = currentStep > step.id;

            return (
              <div key={step.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                      isActive
                        ? 'border-primary-600 bg-primary-50 text-primary-600'
                        : isCompleted
                        ? 'border-green-600 bg-green-50 text-green-600'
                        : 'border-gray-300 bg-white text-gray-400'
                    }`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <StepIcon className="h-5 w-5" />
                    )}
                  </div>
                  <span
                    className={`text-xs mt-1 text-center ${
                      isActive || isCompleted ? 'text-gray-900 font-medium' : 'text-gray-500'
                    }`}
                  >
                    {step.name}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 mx-2 ${
                      isCompleted ? 'bg-green-600' : 'bg-gray-300'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Form Content */}
      <Card>
        <CardContent>
          {error && <FormError message={error} />}
          {success && <FormSuccess message={success} />}

          {renderStepContent()}

          {/* Navigation Buttons */}
          <div className="flex justify-between pt-6 mt-6 border-t">
            <Button
              type="button"
              variant="secondary"
              onClick={handlePrevious}
              disabled={currentStep === 1 || loading}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Previous
            </Button>

            {currentStep < steps.length ? (
              <Button type="button" onClick={handleNext} disabled={loading}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button type="button" onClick={handleSubmit} disabled={loading}>
                {loading ? (
                  <>Submitting...</>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Submit
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
