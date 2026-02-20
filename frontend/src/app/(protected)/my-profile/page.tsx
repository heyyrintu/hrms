'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { selfServiceApi, documentsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
    UserCircle,
    RefreshCw,
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
} from 'lucide-react';
import { DocumentCategory, ChangeRequestStatus } from '@/types';

interface EmployeeProfile {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    employmentType: string;
    payType: string;
    designation?: string;
    joinDate: string;
    status: string;
    department?: { name: string; code: string };
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

const editableFields = [
    { value: 'phone', label: 'Phone Number' },
    { value: 'email', label: 'Email Address' },
    { value: 'firstName', label: 'First Name' },
    { value: 'lastName', label: 'Last Name' },
    { value: 'designation', label: 'Designation' },
];

export default function MyProfilePage() {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>('profile');
    const [profile, setProfile] = useState<EmployeeProfile | null>(null);
    const [documents, setDocuments] = useState<Document[]>([]);
    const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
    const [loading, setLoading] = useState(true);

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

    // Change request modal
    const [changeModalOpen, setChangeModalOpen] = useState(false);
    const [changeForm, setChangeForm] = useState({
        fieldName: 'phone',
        newValue: '',
        reason: '',
    });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        loadProfile();
    }, []);

    useEffect(() => {
        if (profile) {
            if (activeTab === 'documents') loadDocuments();
            if (activeTab === 'requests') loadChangeRequests();
        }
    }, [activeTab, profile]);

    const loadProfile = async () => {
        setLoading(true);
        try {
            const res = await selfServiceApi.getProfile();
            setProfile(res.data);
        } catch (error) {
            console.error('Failed to load profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadDocuments = async () => {
        if (!profile) return;
        try {
            const res = await documentsApi.getByEmployee(profile.id);
            setDocuments(res.data);
        } catch (error) {
            console.error('Failed to load documents:', error);
        }
    };

    const loadChangeRequests = async () => {
        try {
            const res = await selfServiceApi.getMyChangeRequests();
            setChangeRequests(res.data);
        } catch (error) {
            console.error('Failed to load change requests:', error);
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
        } catch (error) {
            console.error('Failed to upload document:', error);
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
        } catch (error) {
            console.error('Failed to download:', error);
        }
    };

    const handleSubmitChangeRequest = async () => {
        setSubmitting(true);
        try {
            await selfServiceApi.createChangeRequest(changeForm);
            setChangeModalOpen(false);
            setChangeForm({ fieldName: 'phone', newValue: '', reason: '' });
            await loadChangeRequests();
        } catch (error) {
            console.error('Failed to submit change request:', error);
        } finally {
            setSubmitting(false);
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

    if (loading) {
        return (
            <>
                <div className="flex items-center justify-center py-20">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                </div>
            </>
        );
    }

    if (!profile) {
        return (
            <>
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
            </>
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
                            View your profile, documents, and change requests
                        </p>
                    </div>
                </div>

                {/* Tabs */}
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

                {/* Profile Tab */}
                {activeTab === 'profile' && (
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
                                            <p className="text-sm font-medium">{profile.designation || '—'}</p>
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
                            <Button className="w-full" onClick={() => setChangeModalOpen(true)}>
                                <Send className="w-4 h-4 mr-2" />
                                Request Profile Change
                            </Button>
                        </div>
                    </div>
                )}

                {/* Documents Tab */}
                {activeTab === 'documents' && (
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
                {activeTab === 'requests' && (
                    <div className="space-y-4">
                        <div className="flex justify-end">
                            <Button onClick={() => setChangeModalOpen(true)}>
                                <Send className="w-4 h-4 mr-2" />
                                New Request
                            </Button>
                        </div>

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
                                                            Change <span className="text-primary-600">{req.fieldName}</span>
                                                        </p>
                                                        <p className="text-xs text-warm-500 mt-1">
                                                            {req.oldValue || '(empty)'} → <span className="font-medium">{req.newValue}</span>
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

            {/* Change Request Modal */}
            <Modal
                isOpen={changeModalOpen}
                onClose={() => setChangeModalOpen(false)}
                title="Request Profile Change"
                size="md"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">Field to Change *</label>
                        <select
                            value={changeForm.fieldName}
                            onChange={(e) => setChangeForm({ ...changeForm, fieldName: e.target.value })}
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            {editableFields.map((f) => (
                                <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                            Current Value
                        </label>
                        <p className="text-sm text-warm-600 bg-warm-50 px-3 py-2 rounded-lg">
                            {String((profile as unknown as Record<string, unknown>)?.[changeForm.fieldName] ?? '(empty)')}
                        </p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">New Value *</label>
                        <input
                            type="text"
                            value={changeForm.newValue}
                            onChange={(e) => setChangeForm({ ...changeForm, newValue: e.target.value })}
                            placeholder="Enter new value"
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">Reason</label>
                        <textarea
                            value={changeForm.reason}
                            onChange={(e) => setChangeForm({ ...changeForm, reason: e.target.value })}
                            placeholder="Why do you need this change?"
                            rows={2}
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                        />
                    </div>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setChangeModalOpen(false)} disabled={submitting}>Cancel</Button>
                    <Button onClick={handleSubmitChangeRequest} loading={submitting} disabled={!changeForm.newValue}>
                        Submit Request
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
