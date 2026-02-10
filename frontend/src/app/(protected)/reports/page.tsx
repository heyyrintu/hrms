'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { reportsApi, departmentsApi } from '@/lib/api';
import {
    FileSpreadsheet,
    Download,
    Calendar,
    Users,
    Clock,
} from 'lucide-react';
import { ReportFormat, ReportType } from '@/types';
import toast from 'react-hot-toast';

interface Department {
    id: string;
    name: string;
}

export default function ReportsPage() {
    const [departments, setDepartments] = useState<Department[]>([]);
    const [generating, setGenerating] = useState(false);

    // Attendance report params
    const [attFrom, setAttFrom] = useState(() => {
        const d = new Date();
        d.setDate(1);
        return d.toISOString().split('T')[0];
    });
    const [attTo, setAttTo] = useState(() => new Date().toISOString().split('T')[0]);
    const [attDeptId, setAttDeptId] = useState('');
    const [attFormat, setAttFormat] = useState<ReportFormat>(ReportFormat.XLSX);

    // Leave report params
    const [leaveYear, setLeaveYear] = useState(String(new Date().getFullYear()));
    const [leaveDeptId, setLeaveDeptId] = useState('');
    const [leaveFormat, setLeaveFormat] = useState<ReportFormat>(ReportFormat.XLSX);

    // Employee report params
    const [empDeptId, setEmpDeptId] = useState('');
    const [empStatus, setEmpStatus] = useState('');
    const [empType, setEmpType] = useState('');
    const [empFormat, setEmpFormat] = useState<ReportFormat>(ReportFormat.XLSX);

    useEffect(() => {
        departmentsApi
            .getAll()
            .then((res) => setDepartments(res.data))
            .catch(() => {});
    }, []);

    const downloadBlob = (blob: Blob, filename: string) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    };

    const handleGenerate = async (type: ReportType) => {
        setGenerating(true);
        try {
            let response;
            let filename: string;
            const ext = type === ReportType.ATTENDANCE
                ? attFormat
                : type === ReportType.LEAVE
                  ? leaveFormat
                  : empFormat;

            switch (type) {
                case ReportType.ATTENDANCE: {
                    const data: Record<string, unknown> = {
                        from: attFrom,
                        to: attTo,
                        format: attFormat,
                    };
                    if (attDeptId) data.departmentId = attDeptId;
                    response = await reportsApi.generateAttendance(data);
                    filename = `attendance_report_${attFrom}_to_${attTo}.${ext}`;
                    break;
                }
                case ReportType.LEAVE: {
                    const data: Record<string, unknown> = {
                        year: leaveYear,
                        format: leaveFormat,
                    };
                    if (leaveDeptId) data.departmentId = leaveDeptId;
                    response = await reportsApi.generateLeave(data);
                    filename = `leave_report_${leaveYear}.${ext}`;
                    break;
                }
                case ReportType.EMPLOYEE: {
                    const data: Record<string, unknown> = {
                        format: empFormat,
                    };
                    if (empDeptId) data.departmentId = empDeptId;
                    if (empStatus) data.status = empStatus;
                    if (empType) data.employmentType = empType;
                    response = await reportsApi.generateEmployees(data);
                    filename = `employee_report.${ext}`;
                    break;
                }
            }

            downloadBlob(response.data, filename);
            toast.success('Report downloaded successfully');
        } catch (error) {
            console.error('Failed to generate report:', error);
            toast.error('Failed to generate report');
        } finally {
            setGenerating(false);
        }
    };

    const formatSelect = (
        value: ReportFormat,
        onChange: (val: ReportFormat) => void,
    ) => (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value as ReportFormat)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
        >
            <option value={ReportFormat.XLSX}>Excel (.xlsx)</option>
            <option value={ReportFormat.CSV}>CSV (.csv)</option>
        </select>
    );

    const deptSelect = (value: string, onChange: (val: string) => void) => (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
        >
            <option value="">All Departments</option>
            {departments.map((d) => (
                <option key={d.id} value={d.id}>
                    {d.name}
                </option>
            ))}
        </select>
    );

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <FileSpreadsheet className="w-7 h-7 text-primary-600" />
                        Reports & Export
                    </h1>
                    <p className="text-gray-600 mt-1">
                        Generate and download reports in Excel or CSV format
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Attendance Report */}
                    <Card>
                        <CardContent className="py-5">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                                    <Clock className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">
                                        Attendance Report
                                    </h3>
                                    <p className="text-xs text-gray-500">
                                        Clock-in/out, hours, OT data
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            From
                                        </label>
                                        <input
                                            type="date"
                                            value={attFrom}
                                            onChange={(e) => setAttFrom(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            To
                                        </label>
                                        <input
                                            type="date"
                                            value={attTo}
                                            onChange={(e) => setAttTo(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Department
                                    </label>
                                    {deptSelect(attDeptId, setAttDeptId)}
                                </div>
                                <div className="flex items-center justify-between gap-3 pt-2">
                                    {formatSelect(attFormat, setAttFormat)}
                                    <Button
                                        onClick={() => handleGenerate(ReportType.ATTENDANCE)}
                                        loading={generating}
                                        disabled={!attFrom || !attTo}
                                        size="sm"
                                    >
                                        <Download className="w-4 h-4 mr-1" />
                                        Download
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Leave Report */}
                    <Card>
                        <CardContent className="py-5">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                                    <Calendar className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">
                                        Leave Report
                                    </h3>
                                    <p className="text-xs text-gray-500">
                                        Balances, usage by type
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Year
                                    </label>
                                    <select
                                        value={leaveYear}
                                        onChange={(e) => setLeaveYear(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                                    >
                                        {[0, 1, 2].map((offset) => {
                                            const y = new Date().getFullYear() - offset;
                                            return (
                                                <option key={y} value={String(y)}>
                                                    {y}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Department
                                    </label>
                                    {deptSelect(leaveDeptId, setLeaveDeptId)}
                                </div>
                                <div className="flex items-center justify-between gap-3 pt-2">
                                    {formatSelect(leaveFormat, setLeaveFormat)}
                                    <Button
                                        onClick={() => handleGenerate(ReportType.LEAVE)}
                                        loading={generating}
                                        size="sm"
                                    >
                                        <Download className="w-4 h-4 mr-1" />
                                        Download
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Employee Report */}
                    <Card>
                        <CardContent className="py-5">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                                    <Users className="w-5 h-5 text-purple-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-900">
                                        Employee Report
                                    </h3>
                                    <p className="text-xs text-gray-500">
                                        Headcount, demographics
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                        Department
                                    </label>
                                    {deptSelect(empDeptId, setEmpDeptId)}
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            Status
                                        </label>
                                        <select
                                            value={empStatus}
                                            onChange={(e) => setEmpStatus(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                                        >
                                            <option value="">All</option>
                                            <option value="ACTIVE">Active</option>
                                            <option value="INACTIVE">Inactive</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                            Type
                                        </label>
                                        <select
                                            value={empType}
                                            onChange={(e) => setEmpType(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                                        >
                                            <option value="">All</option>
                                            <option value="PERMANENT">Permanent</option>
                                            <option value="CONTRACT">Contract</option>
                                            <option value="TEMPORARY">Temporary</option>
                                            <option value="INTERN">Intern</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between gap-3 pt-2">
                                    {formatSelect(empFormat, setEmpFormat)}
                                    <Button
                                        onClick={() => handleGenerate(ReportType.EMPLOYEE)}
                                        loading={generating}
                                        size="sm"
                                    >
                                        <Download className="w-4 h-4 mr-1" />
                                        Download
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}
