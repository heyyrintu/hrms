'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { selfServiceApi, employeesApi, documentsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import {
    UserCircle,
    FileText,
    Upload,
    Download,
    Shield,
    Send,
    Clock,
    CheckCircle,
    XCircle,
    Briefcase,
    Mail,
    Phone,
    Building2,
    CalendarDays,
    Pencil,
    Save,
    X,
    MapPin,
    Heart,
    User,
} from 'lucide-react';
import { DocumentCategory } from '@/types';

interface EmployeeProfile {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    mobileNumber?: string;
    personalEmail?: string;
    gender?: string;
    dateOfBirth?: string;
    fatherName?: string;
    aadhaarNumber?: string;
    maritalStatus?: string;
    bloodGroup?: string;
    currentAddress?: string;
    currentCity?: string;
    currentState?: string;
    currentZipCode?: string;
    currentCountry?: string;
    permanentAddress?: string;
    permanentCity?: string;
    permanentState?: string;
    permanentZipCode?: string;
    permanentCountry?: string;
    emergencyContactName?: string;
    emergencyContactNumber?: string;
    emergencyContactRelation?: string;
    employmentType: string;
    payType: string;
    joinDate: string;
    status: string;
    department?: { name: string; code: string };
    designation?: { id: string; name: string };
    branch?: { id: string; name: string };
    manager?: { firstName: string; lastName: string; employeeCode: string };
    shiftAssignments?: Array<{
        shift: { name: string; code: string; startTime: string; endTime: string };
    }>;
}

interface Document {
    id: string;
    name: string;
    category: string;
    documentDate?: string;
    expiryDate?: string;
    isVerified: boolean;
    upload: { fileName: string; mimeType: string; size: number; key: string };
    createdAt: string;
}

interface ChangeRequest {
    id: string;
    fieldName: string;
    oldValue?: string;
    newValue: string;
    reason?: string;
    status: string;
    reviewNote?: string;
    createdAt: string;
}

type TabType = 'profile' | 'documents' | 'requests';

const categoryOptions = Object.values(DocumentCategory).map((c) => ({
    value: c,
    label: c.replace(/_/g, ' '),
}));

// Editable fields grouped by section
const editableFieldGroups = [
    {
        title: 'Personal Information',
        icon: User,
        fields: [
            { key: 'firstName', label: 'First Name' },
            { key: 'lastName', label: 'Last Name' },
            { key: 'email', label: 'Email Address' },
            { key: 'phone', label: 'Phone Number' },
            { key: 'mobileNumber', label: 'Mobile Number' },
            { key: 'personalEmail', label: 'Personal Email' },
            { key: 'gender', label: 'Gender', type: 'select', options: [
                { value: '', label: 'Select' },
                { value: 'Male', label: 'Male' },
                { value: 'Female', label: 'Female' },
                { value: 'Other', label: 'Other' },
            ]},
            { key: 'fatherName', label: "Father's Name" },
            { key: 'maritalStatus', label: 'Marital Status', type: 'select', options: [
                { value: '', label: 'Select' },
                { value: 'Unmarried', label: 'Unmarried' },
                { value: 'Married', label: 'Married' },
                { value: 'Divorced', label: 'Divorced' },
                { value: 'Widowed', label: 'Widowed' },
            ]},
            { key: 'bloodGroup', label: 'Blood Group', type: 'select', options: [
                { value: '', label: 'Select' },
                { value: 'A+', label: 'A+' }, { value: 'A-', label: 'A-' },
                { value: 'B+', label: 'B+' }, { value: 'B-', label: 'B-' },
                { value: 'AB+', label: 'AB+' }, { value: 'AB-', label: 'AB-' },
                { value: 'O+', label: 'O+' }, { value: 'O-', label: 'O-' },
            ]},
            { key: 'aadhaarNumber', label: 'Aadhaar Number' },
        ],
    },
    {
        title: 'Current Address',
        icon: MapPin,
        fields: [
            { key: 'currentAddress', label: 'Address' },
            { key: 'currentCity', label: 'City' },
            { key: 'currentState', label: 'State' },
            { key: 'currentZipCode', label: 'ZIP Code' },
            { key: 'currentCountry', label: 'Country' },
        ],
    },
    {
        title: 'Permanent Address',
        icon: MapPin,
        fields: [
            { key: 'permanentAddress', label: 'Address' },
            { key: 'permanentCity', label: 'City' },
            { key: 'permanentState', label: 'State' },
            { key: 'permanentZipCode', label: 'ZIP Code' },
            { key: 'permanentCountry', label: 'Country' },
        ],
    },
    {
        title: 'Emergency Contact',
        icon: Heart,
        fields: [
            { key: 'emergencyContactName', label: 'Contact Name' },
            { key: 'emergencyContactNumber', label: 'Contact Number' },
            { key: 'emergencyContactRelation', label: 'Relationship' },
        ],
    },
];

type EditFormData = Record<string, string>;

export default function MyProfilePage() {
    const { user, isAdmin } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>('profile');
    const [profile, setProfile] = useState<EmployeeProfile | null>(null);
    const [documents, setDocuments] = useState<Document[]>([]);
    const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
    const [loading, setLoading] = useState(true);

    // Edit mode
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<EditFormData>({});
    const [saving, setSaving] = useState(false);

    // Upload modal
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadForm, setUploadForm] = useState({
        name: '',
        category: DocumentCategory.OTHER as string,
        documentDate: '',
        expiryDate: '',
    });
    const [uploading, setUploading] = useState(false);

    const loadProfile = useCallback(async () => {
        setLoading(true);
        try {
            const res = await selfServiceApi.getProfile();
            setProfile(res.data);
        } catch (error: unknown) {
            const msg = (error as { response?: { data?: { message?: string } } })
                ?.response?.data?.message || 'Failed to load profile';
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadDocuments = useCallback(async () => {
        if (!profile) return;
        try {
            const res = await documentsApi.getByEmployee(profile.id);
            setDocuments(res.data);
        } catch (error: unknown) {
            const msg = (error as { response?: { data?: { message?: string } } })
                ?.response?.data?.message || 'Failed to load documents';
            toast.error(msg);
        }
    }, [profile]);

    const loadChangeRequests = useCallback(async () => {
        try {
            const res = await selfServiceApi.getMyChangeRequests();
            setChangeRequests(res.data);
        } catch (error: unknown) {
            const msg = (error as { response?: { data?: { message?: string } } })
                ?.response?.data?.message || 'Failed to load change requests';
            toast.error(msg);
        }
    }, []);

    useEffect(() => {
        loadProfile();
    }, [loadProfile]);

    useEffect(() => {
        if (!profile) return;
        if (activeTab === 'documents') loadDocuments();
        if (activeTab === 'requests') loadChangeRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    const getOriginalValue = useCallback((key: string): string => {
        if (!profile) return '';
        return String((profile as unknown as Record<string, unknown>)[key] ?? '');
    }, [profile]);

    const startEditing = () => {
        if (!profile) return;
        const formData: EditFormData = {};
        for (const group of editableFieldGroups) {
            for (const field of group.fields) {
                formData[field.key] = getOriginalValue(field.key);
            }
        }
        setEditForm(formData);
        setIsEditing(true);
    };

    const cancelEditing = () => {
        setIsEditing(false);
        setEditForm({});
    };

    const handleFieldChange = (key: string, value: string) => {
        setEditForm(prev => ({ ...prev, [key]: value }));
    };

    // Memoize changed fields to avoid redundant computation
    const changedFields = useMemo(() => {
        if (!isEditing || !profile) return [];
        const changes: Array<{ fieldName: string; newValue: string }> = [];
        for (const key of Object.keys(editForm)) {
            if (editForm[key] !== getOriginalValue(key)) {
                changes.push({ fieldName: key, newValue: editForm[key] });
            }
        }
        return changes;
    }, [isEditing, editForm, profile, getOriginalValue]);

    const changedCount = changedFields.length;

    const handleSaveProfile = async () => {
        if (!profile) return;

        if (changedFields.length === 0) {
            toast.success('No changes to save');
            setIsEditing(false);
            return;
        }

        setSaving(true);
        try {
            if (isAdmin) {
                // Admin: direct update via employees API
                const updatePayload = Object.fromEntries(
                    changedFields.map(c => [c.fieldName, c.newValue])
                );
                await employeesApi.update(profile.id, updatePayload);
                toast.success('Profile updated successfully');
                setIsEditing(false);
                await loadProfile();
            } else {
                // Employee: create batch change requests
                await selfServiceApi.createBatchChangeRequests(
                    changedFields.map(c => ({ fieldName: c.fieldName, newValue: c.newValue }))
                );
                toast.success(`${changedFields.length} change request(s) submitted for approval`);
                setIsEditing(false);
                await loadProfile();
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message :
                (error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save changes';
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    const handleUploadDocument = async () => {
        if (!profile || !uploadFile) return;
        setUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', uploadFile);
            formData.append('name', uploadForm.name);
            formData.append('category', uploadForm.category);
            if (uploadForm.documentDate) formData.append('documentDate', uploadForm.documentDate);
            if (uploadForm.expiryDate) formData.append('expiryDate', uploadForm.expiryDate);

            await documentsApi.upload(profile.id, formData);
            setUploadModalOpen(false);
            setUploadFile(null);
            setUploadForm({ name: '', category: DocumentCategory.OTHER, documentDate: '', expiryDate: '' });
            await loadDocuments();
        } catch (error: unknown) {
            const msg = (error as { response?: { data?: { message?: string } } })
                ?.response?.data?.message || 'Failed to upload document';
            toast.error(msg);
        } finally {
            setUploading(false);
        }
    };

    const handleDownload = async (doc: Document) => {
        if (!profile) return;
        try {
            const res = await documentsApi.download(profile.id, doc.id);
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', doc.upload.fileName);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error: unknown) {
            const msg = (error as { response?: { data?: { message?: string } } })
                ?.response?.data?.message || 'Failed to download document';
            toast.error(msg);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const statusIcon = (status: string) => {
        switch (status) {
            case 'PENDING': return <Clock className="w-4 h-4 text-yellow-500" />;
            case 'APPROVED': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
            case 'REJECTED': return <XCircle className="w-4 h-4 text-red-500" />;
            default: return null;
        }
    };

    const fieldLabel = (fieldName: string): string => {
        for (const group of editableFieldGroups) {
            const field = group.fields.find(f => f.key === fieldName);
            if (field) return field.label;
        }
        return fieldName;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
            </div>
        );
    }

    if (!profile) {
        return (
            <Card>
                <CardContent className="py-16 text-center">
                    <UserCircle className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-warm-900 mb-2">
                        No Employee Profile
                    </h3>
                    <p className="text-warm-600">
                        Your account is not linked to an employee profile.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
                            <UserCircle className="w-7 h-7 text-primary-600" />
                            My Profile
                        </h1>
                        <p className="text-warm-600 mt-1">
                            {isEditing
                                ? isAdmin
                                    ? 'Edit your profile — changes apply immediately'
                                    : 'Edit your profile — changes will be sent for admin approval'
                                : 'View your profile, documents, and change requests'
                            }
                        </p>
                    </div>
                    {activeTab === 'profile' && !isEditing && (
                        <Button onClick={startEditing}>
                            <Pencil className="w-4 h-4 mr-2" />
                            Edit Profile
                        </Button>
                    )}
                    {isEditing && (
                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={cancelEditing} disabled={saving}>
                                <X className="w-4 h-4 mr-2" />
                                Cancel
                            </Button>
                            <Button onClick={handleSaveProfile} loading={saving} disabled={changedCount === 0}>
                                <Save className="w-4 h-4 mr-2" />
                                {isAdmin ? 'Save Changes' : `Submit ${changedCount > 0 ? `(${changedCount})` : ''}`}
                            </Button>
                        </div>
                    )}
                </div>

                {/* Tabs */}
                {!isEditing && (
                    <div className="border-b border-warm-200">
                        <div className="flex gap-4">
                            {([
                                { key: 'profile', label: 'Profile', icon: UserCircle },
                                { key: 'documents', label: 'Documents', icon: FileText },
                                { key: 'requests', label: 'Change Requests', icon: Send },
                            ] as const).map(({ key, label, icon: Icon }) => (
                                <button
                                    key={key}
                                    onClick={() => setActiveTab(key)}
                                    className={cn(
                                        'pb-3 px-1 text-sm font-medium border-b-2 transition-colors',
                                        activeTab === key
                                            ? 'border-primary-600 text-primary-600'
                                            : 'border-transparent text-warm-500 hover:text-warm-700'
                                    )}
                                >
                                    <Icon className="w-4 h-4 inline mr-2" />
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Edit Mode */}
                {isEditing && (
                    <div className="space-y-6">
                        {!isAdmin && (
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                <p className="text-sm text-blue-800">
                                    Your changes will be submitted as change requests. An admin will review and approve them before they take effect.
                                </p>
                            </div>
                        )}

                        {editableFieldGroups.map((group) => {
                            const GroupIcon = group.icon;
                            return (
                                <Card key={group.title}>
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2 text-base">
                                            <GroupIcon className="w-5 h-5 text-primary-600" />
                                            {group.title}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            {group.fields.map((field) => {
                                                const isChanged = editForm[field.key] !== getOriginalValue(field.key);
                                                const fieldDef = field as { key: string; label: string; type?: string; options?: Array<{ value: string; label: string }> };
                                                return (
                                                    <div key={field.key}>
                                                        <label className="block text-sm font-medium text-warm-700 mb-1">
                                                            {field.label}
                                                            {isChanged && (
                                                                <span className="ml-2 text-xs text-amber-600 font-normal">modified</span>
                                                            )}
                                                        </label>
                                                        {fieldDef.type === 'select' ? (
                                                            <select
                                                                value={editForm[field.key] || ''}
                                                                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                                                className={cn(
                                                                    'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 text-sm',
                                                                    isChanged ? 'border-amber-400 bg-amber-50' : 'border-warm-300'
                                                                )}
                                                            >
                                                                {fieldDef.options?.map((opt) => (
                                                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={editForm[field.key] || ''}
                                                                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                                                                className={cn(
                                                                    'w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 text-sm',
                                                                    isChanged ? 'border-amber-400 bg-amber-50' : 'border-warm-300'
                                                                )}
                                                                placeholder={`Enter ${field.label.toLowerCase()}`}
                                                            />
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}

                        {/* Summary of changes */}
                        {changedCount > 0 && (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">
                                        {changedCount} Change{changedCount > 1 ? 's' : ''} to {isAdmin ? 'Save' : 'Submit'}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        {changedFields.map((change) => (
                                            <div key={change.fieldName} className="flex items-center gap-2 text-sm">
                                                <span className="text-warm-500 min-w-[140px]">{fieldLabel(change.fieldName)}:</span>
                                                <span className="text-warm-400 line-through">{getOriginalValue(change.fieldName) || '(empty)'}</span>
                                                <span className="text-warm-400">&rarr;</span>
                                                <span className="font-medium text-warm-900">{change.newValue || '(empty)'}</span>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                )}

                {/* Profile Tab (View Mode) */}
                {activeTab === 'profile' && !isEditing && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Main Info */}
                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle>Personal Information</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="flex items-center gap-3">
                                        <UserCircle className="w-5 h-5 text-warm-400" />
                                        <div>
                                            <p className="text-xs text-warm-500">Full Name</p>
                                            <p className="text-sm font-medium">{profile.firstName} {profile.lastName}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Mail className="w-5 h-5 text-warm-400" />
                                        <div>
                                            <p className="text-xs text-warm-500">Email</p>
                                            <p className="text-sm font-medium">{profile.email}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Phone className="w-5 h-5 text-warm-400" />
                                        <div>
                                            <p className="text-xs text-warm-500">Phone</p>
                                            <p className="text-sm font-medium">{profile.phone || '—'}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Briefcase className="w-5 h-5 text-warm-400" />
                                        <div>
                                            <p className="text-xs text-warm-500">Designation</p>
                                            <p className="text-sm font-medium">{profile.designation?.name || '—'}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Building2 className="w-5 h-5 text-warm-400" />
                                        <div>
                                            <p className="text-xs text-warm-500">Department</p>
                                            <p className="text-sm font-medium">{profile.department?.name || '—'}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <CalendarDays className="w-5 h-5 text-warm-400" />
                                        <div>
                                            <p className="text-xs text-warm-500">Join Date</p>
                                            <p className="text-sm font-medium">{new Date(profile.joinDate).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    {profile.gender && (
                                        <div className="flex items-center gap-3">
                                            <User className="w-5 h-5 text-warm-400" />
                                            <div>
                                                <p className="text-xs text-warm-500">Gender</p>
                                                <p className="text-sm font-medium">{profile.gender}</p>
                                            </div>
                                        </div>
                                    )}
                                    {profile.fatherName && (
                                        <div className="flex items-center gap-3">
                                            <User className="w-5 h-5 text-warm-400" />
                                            <div>
                                                <p className="text-xs text-warm-500">Father&apos;s Name</p>
                                                <p className="text-sm font-medium">{profile.fatherName}</p>
                                            </div>
                                        </div>
                                    )}
                                    {profile.maritalStatus && (
                                        <div className="flex items-center gap-3">
                                            <Heart className="w-5 h-5 text-warm-400" />
                                            <div>
                                                <p className="text-xs text-warm-500">Marital Status</p>
                                                <p className="text-sm font-medium">{profile.maritalStatus}</p>
                                            </div>
                                        </div>
                                    )}
                                    {profile.bloodGroup && (
                                        <div className="flex items-center gap-3">
                                            <Heart className="w-5 h-5 text-warm-400" />
                                            <div>
                                                <p className="text-xs text-warm-500">Blood Group</p>
                                                <p className="text-sm font-medium">{profile.bloodGroup}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Quick Info */}
                        <div className="space-y-4">
                            <Card>
                                <CardContent className="py-4">
                                    <p className="text-xs text-warm-500 mb-1">Employee Code</p>
                                    <p className="text-lg font-bold text-primary-600">{profile.employeeCode}</p>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="py-4">
                                    <p className="text-xs text-warm-500 mb-1">Employment Type</p>
                                    <Badge variant="info">{profile.employmentType}</Badge>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardContent className="py-4">
                                    <p className="text-xs text-warm-500 mb-1">Manager</p>
                                    <p className="text-sm font-medium">
                                        {profile.manager
                                            ? `${profile.manager.firstName} ${profile.manager.lastName}`
                                            : '—'}
                                    </p>
                                </CardContent>
                            </Card>
                            {profile.branch && (
                                <Card>
                                    <CardContent className="py-4">
                                        <p className="text-xs text-warm-500 mb-1">Location</p>
                                        <p className="text-sm font-medium">{profile.branch.name}</p>
                                    </CardContent>
                                </Card>
                            )}
                            {profile.shiftAssignments?.[0] && (
                                <Card>
                                    <CardContent className="py-4">
                                        <p className="text-xs text-warm-500 mb-1">Current Shift</p>
                                        <p className="text-sm font-medium">
                                            {profile.shiftAssignments[0].shift.name} ({profile.shiftAssignments[0].shift.startTime} - {profile.shiftAssignments[0].shift.endTime})
                                        </p>
                                    </CardContent>
                                </Card>
                            )}
                        </div>

                        {/* Address & Emergency Contact */}
                        {(profile.currentAddress || profile.permanentAddress || profile.emergencyContactName) && (
                            <Card className="lg:col-span-3">
                                <CardContent className="py-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        {profile.currentAddress && (
                                            <div>
                                                <p className="text-xs text-warm-500 mb-1 flex items-center gap-1">
                                                    <MapPin className="w-3 h-3" /> Current Address
                                                </p>
                                                <p className="text-sm">
                                                    {profile.currentAddress}
                                                    {profile.currentCity && `, ${profile.currentCity}`}
                                                    {profile.currentState && `, ${profile.currentState}`}
                                                    {profile.currentZipCode && ` - ${profile.currentZipCode}`}
                                                </p>
                                            </div>
                                        )}
                                        {profile.permanentAddress && (
                                            <div>
                                                <p className="text-xs text-warm-500 mb-1 flex items-center gap-1">
                                                    <MapPin className="w-3 h-3" /> Permanent Address
                                                </p>
                                                <p className="text-sm">
                                                    {profile.permanentAddress}
                                                    {profile.permanentCity && `, ${profile.permanentCity}`}
                                                    {profile.permanentState && `, ${profile.permanentState}`}
                                                    {profile.permanentZipCode && ` - ${profile.permanentZipCode}`}
                                                </p>
                                            </div>
                                        )}
                                        {profile.emergencyContactName && (
                                            <div>
                                                <p className="text-xs text-warm-500 mb-1 flex items-center gap-1">
                                                    <Heart className="w-3 h-3" /> Emergency Contact
                                                </p>
                                                <p className="text-sm font-medium">{profile.emergencyContactName}</p>
                                                {profile.emergencyContactRelation && (
                                                    <p className="text-xs text-warm-500">{profile.emergencyContactRelation}</p>
                                                )}
                                                {profile.emergencyContactNumber && (
                                                    <p className="text-sm">{profile.emergencyContactNumber}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                )}

                {/* Documents Tab */}
                {activeTab === 'documents' && !isEditing && (
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            <Button onClick={() => setUploadModalOpen(true)}>
                                <Upload className="w-4 h-4 mr-2" />
                                Upload Document
                            </Button>
                        </div>

                        {documents.length === 0 ? (
                            <Card>
                                <CardContent className="py-16 text-center">
                                    <FileText className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold text-warm-900 mb-2">No Documents</h3>
                                    <p className="text-warm-600 mb-4">Upload your first document.</p>
                                    <Button onClick={() => setUploadModalOpen(true)}>
                                        <Upload className="w-4 h-4 mr-2" />
                                        Upload Document
                                    </Button>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-warm-200 bg-warm-50">
                                                <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Document</th>
                                                <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Category</th>
                                                <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Size</th>
                                                <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Status</th>
                                                <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-warm-200">
                                            {documents.map((doc) => (
                                                <tr key={doc.id} className="hover:bg-warm-50">
                                                    <td className="px-4 py-3">
                                                        <p className="text-sm font-medium text-warm-900">{doc.name}</p>
                                                        <p className="text-xs text-warm-500">{doc.upload.fileName}</p>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <Badge variant="gray">{doc.category.replace(/_/g, ' ')}</Badge>
                                                    </td>
                                                    <td className="px-4 py-3 text-sm text-warm-600">
                                                        {formatSize(doc.upload.size)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {doc.isVerified ? (
                                                            <Badge variant="success">
                                                                <Shield className="w-3 h-3 mr-1" />
                                                                Verified
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="warning">Pending</Badge>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        <button
                                                            onClick={() => handleDownload(doc)}
                                                            className="p-2 text-warm-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                                        >
                                                            <Download className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Card>
                        )}
                    </div>
                )}

                {/* Change Requests Tab */}
                {activeTab === 'requests' && !isEditing && (
                    <div className="space-y-4">
                        {changeRequests.length === 0 ? (
                            <Card>
                                <CardContent className="py-16 text-center">
                                    <Send className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold text-warm-900 mb-2">No Change Requests</h3>
                                    <p className="text-warm-600">You haven&apos;t submitted any profile change requests yet.</p>
                                </CardContent>
                            </Card>
                        ) : (
                            <div className="space-y-3">
                                {changeRequests.map((req) => (
                                    <Card key={req.id}>
                                        <CardContent className="py-4">
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-start gap-3">
                                                    {statusIcon(req.status)}
                                                    <div>
                                                        <p className="text-sm font-medium text-warm-900">
                                                            Change <span className="text-primary-600">{fieldLabel(req.fieldName)}</span>
                                                        </p>
                                                        <p className="text-xs text-warm-500 mt-1">
                                                            {req.oldValue || '(empty)'} &rarr; <span className="font-medium">{req.newValue}</span>
                                                        </p>
                                                        {req.reason && (
                                                            <p className="text-xs text-warm-400 mt-1">Reason: {req.reason}</p>
                                                        )}
                                                        {req.reviewNote && (
                                                            <p className="text-xs text-warm-500 mt-1 italic">Review: {req.reviewNote}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <Badge variant={
                                                        req.status === 'APPROVED' ? 'success' :
                                                        req.status === 'REJECTED' ? 'danger' : 'warning'
                                                    }>
                                                        {req.status}
                                                    </Badge>
                                                    <p className="text-xs text-warm-400 mt-1">
                                                        {new Date(req.createdAt).toLocaleDateString()}
                                                    </p>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Upload Document Modal */}
            <Modal
                isOpen={uploadModalOpen}
                onClose={() => setUploadModalOpen(false)}
                title="Upload Document"
                size="lg"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">Document Name *</label>
                        <input
                            type="text"
                            value={uploadForm.name}
                            onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                            placeholder="e.g., Aadhaar Card"
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">Category</label>
                        <select
                            value={uploadForm.category}
                            onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            {categoryOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">File *</label>
                        <input
                            type="file"
                            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                        <p className="text-xs text-warm-500 mt-1">Max file size: 10MB</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">Document Date</label>
                            <input
                                type="date"
                                value={uploadForm.documentDate}
                                onChange={(e) => setUploadForm({ ...uploadForm, documentDate: e.target.value })}
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">Expiry Date</label>
                            <input
                                type="date"
                                value={uploadForm.expiryDate}
                                onChange={(e) => setUploadForm({ ...uploadForm, expiryDate: e.target.value })}
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setUploadModalOpen(false)} disabled={uploading}>Cancel</Button>
                    <Button onClick={handleUploadDocument} loading={uploading} disabled={!uploadForm.name || !uploadFile}>
                        Upload
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
