'use client';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { LeaveRequestForm } from '@/components/leave/LeaveRequestForm';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export default function LeaveRequestPage() {
    const router = useRouter();

    const handleSuccess = () => {
        router.push('/leave');
    };

    const handleCancel = () => {
        router.back();
    };

    return (
        <DashboardLayout>
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <button
                        onClick={() => router.back()}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors mb-4"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Leave
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">Apply for Leave</h1>
                    <p className="text-gray-600 mt-1">
                        Fill in the details below to submit your leave request for approval.
                    </p>
                </div>

                {/* Leave Request Form */}
                <LeaveRequestForm
                    onSuccess={handleSuccess}
                    onCancel={handleCancel}
                />
            </div>
        </DashboardLayout>
    );
}
