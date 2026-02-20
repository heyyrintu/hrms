'use client';

import { LeaveCalendar } from '@/components/leave/LeaveCalendar';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';

export default function LeaveCalendarPage() {
    const router = useRouter();

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div>
                    <button
                        onClick={() => router.push('/leave')}
                        className="flex items-center gap-2 text-warm-600 hover:text-warm-900 transition-colors mb-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Leave
                    </button>
                    <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Leave Calendar</h1>
                    <p className="text-warm-600 mt-1">
                        View your leave schedule in a calendar format
                    </p>
                </div>
                <Button onClick={() => router.push('/leave/request')}>
                    <Plus className="w-4 h-4 mr-2" />
                    Request Leave
                </Button>
            </div>

            {/* Calendar */}
            <LeaveCalendar />
        </div>
    );
}
