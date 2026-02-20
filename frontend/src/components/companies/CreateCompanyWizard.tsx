'use client';

import { useState, useRef } from 'react';
import {
  Building2, User, Settings, MapPin,
  Mail, Key, Globe, Phone, FileText,
  CheckCircle2, ArrowLeft, ArrowRight, SkipForward,
} from 'lucide-react';
import { Modal, ModalFooter, FormGrid, FormError, FormSuccess } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { companiesApi } from '@/lib/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const WIZARD_STEPS = [
  { id: 1, label: 'Basic Info', icon: Building2, optional: false },
  { id: 2, label: 'Profile', icon: FileText, optional: true },
  { id: 3, label: 'HR Settings', icon: Settings, optional: true },
  { id: 4, label: 'Geofencing', icon: MapPin, optional: true },
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardFormData {
  // Step 1 — required
  name: string;
  code: string;
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
  // Step 2 — optional profile
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
  // Step 3 — optional HR settings
  timezone: string;
  currency: string;
  financialYearStartMonth: string;
  leaveYearStartMonth: string;
  workDaysPerWeek: string;
  standardWorkHoursPerDay: string;
  payrollFrequency: string;
  payrollProcessingDay: string;
  // Step 4 — optional geofencing
  officeLatitude: string;
  officeLongitude: string;
  officeRadiusMeters: string;
}

const initialForm: WizardFormData = {
  name: '', code: '', adminEmail: '', adminPassword: '', adminFirstName: '', adminLastName: '',
  legalName: '', description: '', website: '', phone: '', email: '', industry: '', companyType: '',
  addressLine1: '', addressLine2: '', city: '', state: '', pinCode: '', country: '',
  pan: '', gstin: '', tan: '', cin: '', pfRegistrationNumber: '', esiRegistrationNumber: '',
  timezone: '', currency: '', financialYearStartMonth: '', leaveYearStartMonth: '',
  workDaysPerWeek: '', standardWorkHoursPerDay: '', payrollFrequency: '', payrollProcessingDay: '',
  officeLatitude: '', officeLongitude: '', officeRadiusMeters: '',
};

interface CreateCompanyWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUpdatePayload(form: WizardFormData): Record<string, unknown> {
  const p: Record<string, unknown> = {};

  // Profile string fields — map '' to undefined (stripped during JSON serialization)
  const strFields: (keyof WizardFormData)[] = [
    'legalName', 'description', 'website', 'phone', 'email',
    'industry', 'companyType', 'addressLine1', 'addressLine2',
    'city', 'state', 'pinCode', 'country',
    'pan', 'gstin', 'tan', 'cin', 'pfRegistrationNumber', 'esiRegistrationNumber',
    'timezone', 'currency',
  ];
  strFields.forEach(k => { if (form[k]) p[k] = form[k]; });

  // HR numeric fields
  if (form.financialYearStartMonth) p.financialYearStartMonth = parseInt(form.financialYearStartMonth);
  if (form.leaveYearStartMonth) p.leaveYearStartMonth = parseInt(form.leaveYearStartMonth);
  if (form.workDaysPerWeek) p.workDaysPerWeek = parseInt(form.workDaysPerWeek);
  if (form.standardWorkHoursPerDay) p.standardWorkHoursPerDay = parseFloat(form.standardWorkHoursPerDay);
  if (form.payrollFrequency) p.payrollFrequency = form.payrollFrequency;
  if (form.payrollProcessingDay) p.payrollProcessingDay = parseInt(form.payrollProcessingDay);

  // Geo — all three or nothing
  const lat = form.officeLatitude.trim() ? parseFloat(form.officeLatitude) : null;
  const lon = form.officeLongitude.trim() ? parseFloat(form.officeLongitude) : null;
  const radius = form.officeRadiusMeters.trim() ? parseInt(form.officeRadiusMeters) : null;
  if (lat !== null && lon !== null && radius !== null) {
    p.officeLatitude = lat;
    p.officeLongitude = lon;
    p.officeRadiusMeters = radius;
  }

  return p;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateCompanyWizard({ isOpen, onClose, onSuccess }: CreateCompanyWizardProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<WizardFormData>(initialForm);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<'idle' | 'success' | 'partial'>('idle');
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -- State helpers --

  const setField = <K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (error) setError('');
  };

  const handleClose = () => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setStep(1);
    setForm(initialForm);
    setError('');
    setSubmitting(false);
    setSubmitResult('idle');
    onClose();
  };

  // -- Auto-code from company name --

  const handleNameChange = (name: string) => {
    setForm(prev => ({
      ...prev,
      name,
      code: name.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g, '_').substring(0, 20),
    }));
    if (error) setError('');
  };

  // -- Validation --

  const validateStep1 = (): boolean => {
    if (!form.name.trim()) { setError('Company name is required'); return false; }
    if (!form.code.trim()) { setError('Company code is required'); return false; }
    if (!/^[A-Z0-9_-]+$/.test(form.code)) { setError('Code must be uppercase letters, numbers, hyphens, or underscores'); return false; }
    if (!form.adminEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) { setError('Valid admin email is required'); return false; }
    if (!form.adminPassword || form.adminPassword.length < 6) { setError('Password must be at least 6 characters'); return false; }
    if (!form.adminFirstName.trim()) { setError('Admin first name is required'); return false; }
    if (!form.adminLastName.trim()) { setError('Admin last name is required'); return false; }
    return true;
  };

  const validateGeo = (): string | null => {
    const lat = form.officeLatitude.trim();
    const lon = form.officeLongitude.trim();
    const radius = form.officeRadiusMeters.trim();
    const filled = [lat, lon, radius].filter(Boolean).length;
    if (filled > 0 && filled < 3) return 'Enter all three geofencing fields or leave all empty.';
    if (!filled) return null;
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const radiusNum = parseInt(radius, 10);
    if (isNaN(latNum)) return 'Latitude must be a valid number.';
    if (isNaN(lonNum)) return 'Longitude must be a valid number.';
    if (isNaN(radiusNum)) return 'Radius must be a valid integer.';
    if (latNum < -90 || latNum > 90) return 'Latitude must be between -90 and 90.';
    if (lonNum < -180 || lonNum > 180) return 'Longitude must be between -180 and 180.';
    if (radiusNum < 1) return 'Radius must be at least 1 metre.';
    return null;
  };

  // -- Navigation --

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    setError('');
    setStep(s => Math.min(s + 1, 4));
  };

  const handleBack = () => {
    setError('');
    setStep(s => Math.max(s - 1, 1));
  };

  // -- Submit --

  const handleSubmit = async () => {
    // Validate geo before submitting
    const geoError = validateGeo();
    if (geoError) { setError(geoError); return; }

    setSubmitting(true);
    setError('');
    try {
      const createRes = await companiesApi.create({
        name: form.name,
        code: form.code,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
        adminFirstName: form.adminFirstName,
        adminLastName: form.adminLastName,
      });
      const companyId: string = createRes.data.company.id;

      const updatePayload = buildUpdatePayload(form);
      if (Object.keys(updatePayload).length > 0) {
        try {
          await companiesApi.update(companyId, updatePayload);
        } catch {
          setSubmitResult('partial');
          setSubmitting(false);
          autoCloseTimerRef.current = setTimeout(() => { onSuccess(); handleClose(); }, 2500);
          return;
        }
      }

      setSubmitResult('success');
      setSubmitting(false);
      autoCloseTimerRef.current = setTimeout(() => { onSuccess(); handleClose(); }, 1500);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message || 'Failed to create company');
      setSubmitting(false);
    }
  };

  // -- Progress Indicator --

  const renderProgressIndicator = () => (
    <div className="flex items-center justify-between mb-5 px-1">
      {WIZARD_STEPS.map((s, i) => {
        const StepIcon = s.icon;
        const isActive = step === s.id;
        const isCompleted = step > s.id;

        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors
                ${isCompleted ? 'bg-emerald-100 text-emerald-700' : ''}
                ${isActive ? 'bg-primary-600 text-white' : ''}
                ${!isActive && !isCompleted ? 'bg-warm-100 text-warm-400' : ''}
              `}>
                {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <StepIcon className="h-4 w-4" />}
              </div>
              <span className={`text-[10px] mt-1 whitespace-nowrap ${isActive ? 'text-primary-600 font-medium' : 'text-warm-400'}`}>
                {s.label}
              </span>
              {s.optional && (
                <span className="text-[9px] text-warm-300">optional</span>
              )}
            </div>
            {i < WIZARD_STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 mt-[-12px] ${isCompleted ? 'bg-emerald-300' : 'bg-warm-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );

  // -- Step 1: Basic Info + Admin --

  const renderStep1 = () => (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-medium text-warm-900 mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4" /> Company Information
        </h4>
        <FormGrid cols={2}>
          <div>
            <Input label="Company Name *" value={form.name}
              onChange={(e) => handleNameChange(e.target.value)} placeholder="Acme Corporation" />
          </div>
          <div>
            <Input label="Company Code *" value={form.code}
              onChange={(e) => setField('code', e.target.value.toUpperCase())}
              placeholder="ACME_CORP" className="font-mono" />
            <p className="text-xs text-warm-500 mt-1">Uppercase letters, numbers, hyphens, underscores.</p>
          </div>
        </FormGrid>
      </div>

      <div>
        <h4 className="text-sm font-medium text-warm-900 mb-3 flex items-center gap-2">
          <User className="h-4 w-4" /> Initial HR Admin User
        </h4>
        <p className="text-sm text-warm-500 mb-3">This user will manage the new company as HR Admin.</p>
        <FormGrid cols={2}>
          <div>
            <Input label="First Name *" value={form.adminFirstName}
              onChange={(e) => setField('adminFirstName', e.target.value)} placeholder="John" />
          </div>
          <div>
            <Input label="Last Name *" value={form.adminLastName}
              onChange={(e) => setField('adminLastName', e.target.value)} placeholder="Doe" />
          </div>
          <div className="relative">
            <Mail className="absolute left-3 top-9 h-4 w-4 text-warm-400 z-10" />
            <Input label="Email *" type="email" value={form.adminEmail}
              onChange={(e) => setField('adminEmail', e.target.value)}
              placeholder="admin@company.com" className="pl-10" />
          </div>
          <div className="relative">
            <Key className="absolute left-3 top-9 h-4 w-4 text-warm-400 z-10" />
            <Input label="Password *" type="password" value={form.adminPassword}
              onChange={(e) => setField('adminPassword', e.target.value)}
              placeholder="••••••••" className="pl-10" />
            <p className="text-xs text-warm-500 mt-1">Minimum 6 characters</p>
          </div>
        </FormGrid>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h5 className="text-sm font-medium text-blue-900 mb-2">What gets created:</h5>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• A new isolated company/tenant</li>
          <li>• HR Admin user account for the company</li>
          <li>• Default leave types (Annual, Sick, Casual)</li>
          <li>• Default overtime rules</li>
        </ul>
      </div>
    </div>
  );

  // -- Step 2: Company Profile --

  const renderStep2 = () => (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-medium text-warm-900 mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4" /> Basic Information
        </h4>
        <FormGrid cols={2}>
          <div>
            <Input label="Legal / Registered Name" value={form.legalName}
              onChange={(e) => setField('legalName', e.target.value)}
              placeholder="As per incorporation documents" />
          </div>
          <div>
            <Input label="Industry" value={form.industry}
              onChange={(e) => setField('industry', e.target.value)}
              placeholder="e.g. IT & Software" />
          </div>
          <div>
            <Select label="Company Type" value={form.companyType}
              onChange={(e) => setField('companyType', e.target.value)}>
              {COMPANY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
          <div>
            <div className="relative">
              <Globe className="absolute left-3 top-9 h-4 w-4 text-warm-400 z-10" />
              <Input label="Website" value={form.website}
                onChange={(e) => setField('website', e.target.value)}
                placeholder="https://example.com" className="pl-10" />
            </div>
          </div>
          <div>
            <div className="relative">
              <Phone className="absolute left-3 top-9 h-4 w-4 text-warm-400 z-10" />
              <Input label="Contact Phone" value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                placeholder="+91 99999 99999" className="pl-10" />
            </div>
          </div>
          <div>
            <div className="relative">
              <Mail className="absolute left-3 top-9 h-4 w-4 text-warm-400 z-10" />
              <Input label="Contact Email" type="email" value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                placeholder="hr@company.com" className="pl-10" />
            </div>
          </div>
        </FormGrid>
        <div className="mt-3">
          <Input label="Description" value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            placeholder="Brief company description..." />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-warm-600 uppercase tracking-wide mb-3">Registered Address</p>
        <FormGrid cols={2}>
          <div className="sm:col-span-2">
            <Input label="Address Line 1" value={form.addressLine1}
              onChange={(e) => setField('addressLine1', e.target.value)}
              placeholder="123 Main Street" />
          </div>
          <div className="sm:col-span-2">
            <Input label="Address Line 2" value={form.addressLine2}
              onChange={(e) => setField('addressLine2', e.target.value)}
              placeholder="Suite 400" />
          </div>
          <div>
            <Input label="City" value={form.city}
              onChange={(e) => setField('city', e.target.value)}
              placeholder="Mumbai" />
          </div>
          <div>
            <Input label="State" value={form.state}
              onChange={(e) => setField('state', e.target.value)}
              placeholder="Maharashtra" />
          </div>
          <div>
            <Input label="PIN Code" value={form.pinCode}
              onChange={(e) => setField('pinCode', e.target.value)}
              placeholder="400001" />
          </div>
          <div>
            <Input label="Country" value={form.country}
              onChange={(e) => setField('country', e.target.value)}
              placeholder="India" />
          </div>
        </FormGrid>
      </div>

      <div>
        <p className="text-xs font-semibold text-warm-600 uppercase tracking-wide mb-3">Legal / Tax Identifiers</p>
        <FormGrid cols={2}>
          <div>
            <Input label="PAN" value={form.pan}
              onChange={(e) => setField('pan', e.target.value.toUpperCase())}
              placeholder="AAAAA9999A" className="font-mono" />
          </div>
          <div>
            <Input label="GSTIN" value={form.gstin}
              onChange={(e) => setField('gstin', e.target.value.toUpperCase())}
              placeholder="27AAAAA9999A1Z5" className="font-mono" />
          </div>
          <div>
            <Input label="TAN" value={form.tan}
              onChange={(e) => setField('tan', e.target.value.toUpperCase())}
              placeholder="AAAA99999A" className="font-mono" />
          </div>
          <div>
            <Input label="CIN" value={form.cin}
              onChange={(e) => setField('cin', e.target.value.toUpperCase())}
              placeholder="L17110MH1973PLC019786" className="font-mono" />
          </div>
          <div>
            <Input label="PF Registration No." value={form.pfRegistrationNumber}
              onChange={(e) => setField('pfRegistrationNumber', e.target.value.toUpperCase())}
              placeholder="MHBAN0000000000" className="font-mono" />
          </div>
          <div>
            <Input label="ESI Registration No." value={form.esiRegistrationNumber}
              onChange={(e) => setField('esiRegistrationNumber', e.target.value.toUpperCase())}
              placeholder="00000000000000000" className="font-mono" />
          </div>
        </FormGrid>
      </div>
    </div>
  );

  // -- Step 3: HR Settings --

  const renderStep3 = () => (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-medium text-warm-900 mb-3 flex items-center gap-2">
          <Settings className="h-4 w-4" /> HR & Payroll Configuration
        </h4>
        <p className="text-sm text-warm-500 mb-3">Defaults will be used if you skip this step (Asia/Kolkata, INR, etc.)</p>
        <FormGrid cols={2}>
          <div>
            <Input label="Timezone" value={form.timezone}
              onChange={(e) => setField('timezone', e.target.value)}
              placeholder="Asia/Kolkata" />
          </div>
          <div>
            <Input label="Currency (ISO 4217)" value={form.currency}
              onChange={(e) => setField('currency', e.target.value.toUpperCase())}
              placeholder="INR" maxLength={3} className="font-mono" />
          </div>
          <div>
            <Select label="Financial Year Start" value={form.financialYearStartMonth}
              onChange={(e) => setField('financialYearStartMonth', e.target.value)}
              placeholder="Select month..." options={monthOptions} />
          </div>
          <div>
            <Select label="Leave Year Start" value={form.leaveYearStartMonth}
              onChange={(e) => setField('leaveYearStartMonth', e.target.value)}
              placeholder="Select month..." options={monthOptions} />
          </div>
          <div>
            <Input label="Work Days / Week" type="number" min={1} max={7}
              value={form.workDaysPerWeek}
              onChange={(e) => setField('workDaysPerWeek', e.target.value)}
              placeholder="5" />
          </div>
          <div>
            <Input label="Standard Hours / Day" type="number" min={1} max={24} step="0.5"
              value={form.standardWorkHoursPerDay}
              onChange={(e) => setField('standardWorkHoursPerDay', e.target.value)}
              placeholder="8" />
          </div>
          <div>
            <Select label="Payroll Frequency" value={form.payrollFrequency}
              onChange={(e) => setField('payrollFrequency', e.target.value)}
              placeholder="Select..." options={PAYROLL_FREQ} />
          </div>
          <div>
            <Input label="Payroll Processing Day" type="number" min={1} max={31}
              value={form.payrollProcessingDay}
              onChange={(e) => setField('payrollProcessingDay', e.target.value)}
              placeholder="28" />
            <p className="text-xs text-warm-400 mt-1">Day of month payroll is processed</p>
          </div>
        </FormGrid>
      </div>
    </div>
  );

  // -- Step 4: Geofencing --

  const renderStep4 = () => (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-medium text-warm-900 mb-3 flex items-center gap-2">
          <MapPin className="h-4 w-4" /> Office Geofencing
        </h4>
        <p className="text-sm text-warm-500 mb-3">
          Set office coordinates and radius for attendance geofencing. Leave all empty to disable.
        </p>
        <FormGrid cols={3}>
          <div>
            <Input label="Latitude" type="number" step="any"
              value={form.officeLatitude}
              onChange={(e) => setField('officeLatitude', e.target.value)}
              placeholder="28.6139" />
            <p className="text-xs text-warm-400 mt-1">-90 to 90</p>
          </div>
          <div>
            <Input label="Longitude" type="number" step="any"
              value={form.officeLongitude}
              onChange={(e) => setField('officeLongitude', e.target.value)}
              placeholder="77.2090" />
            <p className="text-xs text-warm-400 mt-1">-180 to 180</p>
          </div>
          <div>
            <Input label="Radius (metres)" type="number" min={1}
              value={form.officeRadiusMeters}
              onChange={(e) => setField('officeRadiusMeters', e.target.value)}
              placeholder="200" />
            <p className="text-xs text-warm-400 mt-1">Min 1 metre</p>
          </div>
        </FormGrid>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h5 className="text-sm font-medium text-blue-900 mb-2">Ready to create!</h5>
        <p className="text-sm text-blue-700">
          Click &ldquo;Create Company&rdquo; to finish. You can always update these settings later from the company details panel.
        </p>
      </div>
    </div>
  );

  // -- Render --

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create New Company" size="2xl">
      {renderProgressIndicator()}

      {error && <FormError message={error} className="mb-4" />}
      {submitResult === 'success' && <FormSuccess message="Company created successfully!" className="mb-4" />}
      {submitResult === 'partial' && (
        <div className="mb-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
          <p className="text-sm text-yellow-800">
            Company created successfully. Some optional settings could not be saved — you can edit them from the company list.
          </p>
        </div>
      )}

      <div className="max-h-[55vh] overflow-y-auto pr-1">
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>

      <ModalFooter>
        <div className="sm:mr-auto">
          <Button variant="secondary" onClick={handleBack} disabled={step === 1 || submitting}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </div>
        {step >= 2 && step <= 3 && (
          <Button variant="ghost" onClick={handleNext} disabled={submitting}>
            <SkipForward className="h-3.5 w-3.5 mr-1" /> Skip for Later
          </Button>
        )}
        {step <= 3 ? (
          <Button onClick={handleNext} disabled={submitting}>
            Next <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={submitting || submitResult !== 'idle'} loading={submitting}>
            Create Company
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
