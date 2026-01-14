'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { cn, formatDate, getStatusColor } from '@/lib/utils';
import {
    Check,
    X,
    Calendar,
    User,
    FileText,
    Clock,
    Building,
} from 'lucide-react';

interface LeaveRequest {
    id: string;
    leaveType: { name: string; code: string };
    employee: {
        id: string;
        firstName: string;
        lastName: string;
        employeeCode: string;
        department?: { name: string };
    };
    startDate: string;
    endDate: string;
    totalDays: number;
    status: string;
    reason?: string;
    createdAt: string;
}

interface ApprovalCardProps {
    request: LeaveRequest;
    onApprove: (id: string, note?: string) => Promise<void>;
    onReject: (id: string, note?: string) => Promise<void>;
}

export function ApprovalCard({ request, onApprove, onReject }: ApprovalCardProps) {
    const [modalType, setModalType] = useState<'approve' | 'reject' | null>(null);
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAction = async () => {
        setLoading(true);
        try {
            if (modalType === 'approve') {
                await onApprove(request.id, note);
            } else if (modalType === 'reject') {
                await onReject(request.id, note);
            }
            setModalType(null);
            setNote('');
        } finally {
            setLoading(false);
        }
    };

    const getLeaveTypeColor = (code: string): string => {
        const colors: Record<string, string> = {
            'CL': 'from-blue-500 to-blue-600',
            'SL': 'from-red-500 to-red-600',
            'PL': 'from-green-500 to-green-600',
            'LOP': 'from-gray-500 to-gray-600',
            'ML': 'from-pink-500 to-pink-600',
            'PFL': 'from-purple-500 to-purple-600',
        };
        return colors[code] || 'from-indigo-500 to-indigo-600';
    };

    return (
        <>
            <Card className="hover:shadow-md transition-shadow">
                <CardContent className="p-0">
                    {/* Header - Leave Type */}
                    <div className={cn(
                        'px-4 py-3 text-white bg-gradient-to-r rounded-t-lg',
                        getLeaveTypeColor(request.leaveType.code)
                    )}>
                        <div className="flex items-center justify-between">
                            <span className="font-semibold">{request.leaveType.name}</span>
                            <span className={cn('badge', getStatusColor(request.status))}>
                                {request.status}
                            </span>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="p-4 space-y-4">
                        {/* Employee Info */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                                <User className="w-5 h-5 text-gray-500" />
                            </div>
                            <div>
                                <div className="font-medium text-gray-900">
                                    {request.employee.firstName} {request.employee.lastName}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {request.employee.employeeCode}
                                </div>
                            </div>
                        </div>

                        {/* Details */}
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="flex items-center gap-2 text-gray-600">
                                <Calendar className="w-4 h-4" />
                                <span>{formatDate(request.startDate)}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                                <Calendar className="w-4 h-4" />
                                <span>{formatDate(request.endDate)}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                                <Clock className="w-4 h-4" />
                                <span>{request.totalDays} day{request.totalDays > 1 ? 's' : ''}</span>
                            </div>
                            {request.employee.department && (
                                <div className="flex items-center gap-2 text-gray-600">
                                    <Building className="w-4 h-4" />
                                    <span className="truncate">{request.employee.department.name}</span>
                                </div>
                            )}
                        </div>

                        {/* Reason */}
                        {request.reason && (
                            <div className="p-3 bg-gray-50 rounded-lg">
                                <div className="flex items-start gap-2">
                                    <FileText className="w-4 h-4 text-gray-400 mt-0.5" />
                                    <p className="text-sm text-gray-700">{request.reason}</p>
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        {request.status === 'PENDING' && (
                            <div className="flex gap-2 pt-2 border-t border-gray-100">
                                <Button
                                    variant="danger"
                                    size="sm"
                                    className="flex-1"
                                    onClick={() => setModalType('reject')}
                                >
                                    <X className="w-4 h-4 mr-1" />
                                    Reject
                                </Button>
                                <Button
                                    size="sm"
                                    className="flex-1 bg-green-600 hover:bg-green-700"
                                    onClick={() => setModalType('approve')}
                                >
                                    <Check className="w-4 h-4 mr-1" />
                                    Approve
                                </Button>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Approval/Rejection Modal */}
            <Modal
                isOpen={modalType !== null}
                onClose={() => {
                    setModalType(null);
                    setNote('');
                }}
                title={modalType === 'approve' ? 'Approve Leave Request' : 'Reject Leave Request'}
                size="md"
            >
                <div className="space-y-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border border-gray-200">
                                <User className="w-5 h-5 text-gray-500" />
                            </div>
                            <div>
                                <div className="font-medium text-gray-900">
                                    {request.employee.firstName} {request.employee.lastName}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {request.leaveType.name} • {request.totalDays} day{request.totalDays > 1 ? 's' : ''}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {formatDate(request.startDate)} — {formatDate(request.endDate)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Add a note (optional)
                        </label>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder={
                                modalType === 'approve'
                                    ? 'Any notes for the employee...'
                                    : 'Reason for rejection...'
                            }
                            rows={3}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                        />
                    </div>
                </div>

                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => {
                            setModalType(null);
                            setNote('');
                        }}
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant={modalType === 'approve' ? 'primary' : 'danger'}
                        onClick={handleAction}
                        loading={loading}
                        className={modalType === 'approve' ? 'bg-green-600 hover:bg-green-700' : ''}
                    >
                        {modalType === 'approve' ? 'Approve' : 'Reject'}
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
