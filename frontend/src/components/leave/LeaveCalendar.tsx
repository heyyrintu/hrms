'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { leaveApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

interface LeaveRequest {
    id: string;
    leaveType: { name: string; code: string };
    startDate: string;
    endDate: string;
    totalDays: number;
    status: string;
}

interface CalendarDay {
    date: Date;
    isCurrentMonth: boolean;
    isToday: boolean;
    isWeekend: boolean;
    leaves: LeaveRequest[];
}

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function LeaveCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, [currentDate]);

    const loadData = async () => {
        try {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const startOfMonth = new Date(year, month, 1);
            const endOfMonth = new Date(year, month + 1, 0);

            const res = await leaveApi.getMyRequests({
                from: startOfMonth.toISOString().split('T')[0],
                to: endOfMonth.toISOString().split('T')[0],
            });
            setRequests(res.data.data || []);
        } catch (error) {
            console.error('Failed to load calendar data:', error);
        } finally {
            setLoading(false);
        }
    };

    const getCalendarDays = (): CalendarDay[] => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);
        const startingDayOfWeek = firstDayOfMonth.getDay();
        const daysInMonth = lastDayOfMonth.getDate();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const days: CalendarDay[] = [];

        // Previous month days
        const prevMonth = new Date(year, month, 0);
        for (let i = startingDayOfWeek - 1; i >= 0; i--) {
            const date = new Date(year, month - 1, prevMonth.getDate() - i);
            days.push({
                date,
                isCurrentMonth: false,
                isToday: date.getTime() === today.getTime(),
                isWeekend: date.getDay() === 0 || date.getDay() === 6,
                leaves: getLeaveForDate(date),
            });
        }

        // Current month days
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            days.push({
                date,
                isCurrentMonth: true,
                isToday: date.toDateString() === today.toDateString(),
                isWeekend: date.getDay() === 0 || date.getDay() === 6,
                leaves: getLeaveForDate(date),
            });
        }

        // Next month days
        const remainingDays = 42 - days.length; // 6 rows * 7 days
        for (let day = 1; day <= remainingDays; day++) {
            const date = new Date(year, month + 1, day);
            days.push({
                date,
                isCurrentMonth: false,
                isToday: date.getTime() === today.getTime(),
                isWeekend: date.getDay() === 0 || date.getDay() === 6,
                leaves: getLeaveForDate(date),
            });
        }

        return days;
    };

    const getLeaveForDate = (date: Date): LeaveRequest[] => {
        return requests.filter(req => {
            const startDate = new Date(req.startDate);
            const endDate = new Date(req.endDate);
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(0, 0, 0, 0);
            date.setHours(0, 0, 0, 0);
            return date >= startDate && date <= endDate && req.status !== 'CANCELLED' && req.status !== 'REJECTED';
        });
    };

    const getLeaveColor = (code: string, status: string): string => {
        if (status === 'PENDING') {
            return 'bg-yellow-400/80';
        }
        const colors: Record<string, string> = {
            'CL': 'bg-blue-500',
            'SL': 'bg-red-500',
            'PL': 'bg-green-500',
            'LOP': 'bg-gray-500',
            'ML': 'bg-pink-500',
            'PFL': 'bg-purple-500',
        };
        return colors[code] || 'bg-indigo-500';
    };

    const goToPreviousMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    };

    const goToNextMonth = () => {
        setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    };

    const goToToday = () => {
        setCurrentDate(new Date());
    };

    const calendarDays = getCalendarDays();

    return (
        <Card>
            <CardHeader className="border-b border-gray-100">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <CalendarIcon className="w-5 h-5 text-primary-600" />
                        Leave Calendar
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={goToPreviousMonth}>
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-sm font-medium min-w-[140px] text-center">
                            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                        </span>
                        <Button variant="ghost" size="sm" onClick={goToNextMonth}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                        <Button variant="secondary" size="sm" onClick={goToToday} className="ml-2">
                            Today
                        </Button>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-0">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : (
                    <>
                        {/* Day Headers */}
                        <div className="grid grid-cols-7 border-b border-gray-100">
                            {DAYS.map((day, index) => (
                                <div
                                    key={day}
                                    className={cn(
                                        'py-3 text-center text-xs font-semibold uppercase tracking-wider',
                                        index === 0 || index === 6 ? 'text-gray-400' : 'text-gray-600'
                                    )}
                                >
                                    {day}
                                </div>
                            ))}
                        </div>

                        {/* Calendar Grid */}
                        <div className="grid grid-cols-7">
                            {calendarDays.map((day, index) => (
                                <div
                                    key={index}
                                    className={cn(
                                        'min-h-[80px] p-1 border-b border-r border-gray-100',
                                        !day.isCurrentMonth && 'bg-gray-50',
                                        day.isWeekend && day.isCurrentMonth && 'bg-gray-50/50'
                                    )}
                                >
                                    <div
                                        className={cn(
                                            'text-sm mb-1 w-7 h-7 flex items-center justify-center rounded-full',
                                            !day.isCurrentMonth && 'text-gray-400',
                                            day.isWeekend && 'text-gray-400',
                                            day.isToday && 'bg-primary-600 text-white font-semibold',
                                            day.isCurrentMonth && !day.isToday && !day.isWeekend && 'text-gray-900',
                                        )}
                                    >
                                        {day.date.getDate()}
                                    </div>

                                    {/* Leave Indicators */}
                                    <div className="space-y-0.5">
                                        {day.leaves.slice(0, 2).map((leave, idx) => (
                                            <div
                                                key={`${leave.id}-${idx}`}
                                                className={cn(
                                                    'text-xs px-1.5 py-0.5 rounded text-white truncate',
                                                    getLeaveColor(leave.leaveType.code, leave.status)
                                                )}
                                                title={`${leave.leaveType.name} (${leave.status})`}
                                            >
                                                {leave.leaveType.code}
                                            </div>
                                        ))}
                                        {day.leaves.length > 2 && (
                                            <div className="text-xs text-gray-500 pl-1">
                                                +{day.leaves.length - 2} more
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Legend */}
                        <div className="p-4 border-t border-gray-100 flex items-center gap-4 flex-wrap">
                            <span className="text-xs font-medium text-gray-500">Legend:</span>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded bg-blue-500" />
                                <span className="text-xs text-gray-600">CL</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded bg-red-500" />
                                <span className="text-xs text-gray-600">SL</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded bg-green-500" />
                                <span className="text-xs text-gray-600">PL</span>
                            </div>
                            <div className="flex items-center gap-1">
                                <div className="w-3 h-3 rounded bg-yellow-400" />
                                <span className="text-xs text-gray-600">Pending</span>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
