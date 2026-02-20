'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { cn, formatDate, formatTime, formatMinutesToHours } from '@/lib/utils';
import {
  Check,
  Calendar,
  User,
  Clock,
  Building,
  AlertCircle,
} from 'lucide-react';
import { AttendanceRecord } from '@/types';

interface OTApprovalCardProps {
  record: AttendanceRecord;
  onApprove: (id: string, minutes: number, remarks?: string) => Promise<void>;
}

export function OTApprovalCard({ record, onApprove }: OTApprovalCardProps) {
  const [showModal, setShowModal] = useState(false);
  const [approvedMinutes, setApprovedMinutes] = useState(record.otMinutesCalculated);
  const [remarks, setRemarks] = useState('');
  const [loading, setLoading] = useState(false);

  const handleApprove = async () => {
    setLoading(true);
    try {
      await onApprove(record.id, approvedMinutes, remarks);
      setShowModal(false);
      setRemarks('');
    } finally {
      setLoading(false);
    }
  };

  const isApproved = record.otMinutesApproved !== null && record.otMinutesApproved !== undefined;
  const percentage = Math.round((approvedMinutes / record.otMinutesCalculated) * 100);

  return (
    <>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-0">
          {/* Header - OT Badge */}
          <div className={cn(
            'px-4 py-3 text-white bg-gradient-to-r rounded-t-lg',
            isApproved ? 'from-emerald-500 to-emerald-600' : 'from-orange-500 to-orange-600'
          )}>
            <div className="flex items-center justify-between">
              <span className="font-semibold">Overtime Approval</span>
              <span className={cn(
                'px-2 py-1 rounded-full text-xs font-medium',
                isApproved ? 'bg-white/20' : 'bg-white/30'
              )}>
                {isApproved ? 'APPROVED' : 'PENDING'}
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            {/* Employee Info */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-warm-100 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-warm-500" />
              </div>
              <div>
                <div className="font-medium text-warm-900">
                  {record.employee?.firstName} {record.employee?.lastName}
                </div>
                <div className="text-sm text-warm-500">
                  {record.employee?.employeeCode}
                </div>
              </div>
            </div>

            {/* Date & Time Details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-warm-600">
                <Calendar className="w-4 h-4" />
                <span>{formatDate(record.date)}</span>
              </div>
              <div className="flex items-center gap-2 text-warm-600">
                <Clock className="w-4 h-4" />
                <span>
                  {record.clockInTime && formatTime(record.clockInTime)} - {record.clockOutTime && formatTime(record.clockOutTime)}
                </span>
              </div>
              {record.employee?.department && (
                <div className="flex items-center gap-2 text-warm-600 col-span-2">
                  <Building className="w-4 h-4" />
                  <span className="truncate">{record.employee.department.name}</span>
                </div>
              )}
            </div>

            {/* Work Summary */}
            <div className="p-3 bg-warm-50 rounded-lg space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-warm-600">Standard Work:</span>
                <span className="font-medium">{formatMinutesToHours(record.standardWorkMinutes)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-warm-600">Actual Work:</span>
                <span className="font-medium">{formatMinutesToHours(record.workedMinutes)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-sm">
                <span className="text-warm-900 font-semibold">Calculated OT:</span>
                <span className="font-bold text-orange-600">
                  {formatMinutesToHours(record.otMinutesCalculated)}
                </span>
              </div>
              {isApproved && (
                <div className="flex justify-between text-sm border-t pt-2">
                  <span className="text-warm-900 font-semibold">Approved OT:</span>
                  <span className="font-bold text-emerald-600">
                    {formatMinutesToHours(record.otMinutesApproved || 0)}
                  </span>
                </div>
              )}
            </div>

            {/* Remarks */}
            {record.remarks && (
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-blue-900 mb-1">Work Summary:</p>
                    <p className="text-sm text-blue-800">{record.remarks}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            {!isApproved && (
              <div className="pt-2 border-t border-warm-100">
                <Button
                  className="w-full bg-orange-600 hover:bg-orange-700"
                  onClick={() => setShowModal(true)}
                >
                  <Check className="w-4 h-4 mr-2" />
                  Approve OT
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Approval Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setRemarks('');
          setApprovedMinutes(record.otMinutesCalculated);
        }}
        title="Approve Overtime"
        size="md"
      >
        <div className="space-y-4">
          {/* Employee Summary */}
          <div className="p-4 bg-warm-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center border border-warm-200">
                <User className="w-5 h-5 text-warm-500" />
              </div>
              <div>
                <div className="font-medium text-warm-900">
                  {record.employee?.firstName} {record.employee?.lastName}
                </div>
                <div className="text-sm text-warm-500">
                  {formatDate(record.date)} • {formatMinutesToHours(record.otMinutesCalculated)} OT
                </div>
              </div>
            </div>
          </div>

          {/* OT Adjustment */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-2">
              Approved OT Minutes
            </label>
            <div className="space-y-3">
              {/* Slider */}
              <input
                type="range"
                min="0"
                max={record.otMinutesCalculated}
                value={approvedMinutes}
                onChange={(e) => setApprovedMinutes(Number(e.target.value))}
                className="w-full h-2 bg-warm-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
              />

              {/* Value Display */}
              <div className="flex items-center justify-between">
                <div className="text-sm text-warm-600">
                  {formatMinutesToHours(approvedMinutes)} ({percentage}%)
                </div>
                <input
                  type="number"
                  min="0"
                  max={record.otMinutesCalculated}
                  value={approvedMinutes}
                  onChange={(e) => setApprovedMinutes(Math.min(record.otMinutesCalculated, Math.max(0, Number(e.target.value))))}
                  className="w-20 px-2 py-1 text-sm border border-warm-300 rounded focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                />
              </div>

              {/* Quick Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setApprovedMinutes(0)}
                  className="px-3 py-1 text-xs border border-warm-300 rounded hover:bg-warm-50"
                >
                  0%
                </button>
                <button
                  onClick={() => setApprovedMinutes(Math.floor(record.otMinutesCalculated / 2))}
                  className="px-3 py-1 text-xs border border-warm-300 rounded hover:bg-warm-50"
                >
                  50%
                </button>
                <button
                  onClick={() => setApprovedMinutes(record.otMinutesCalculated)}
                  className="px-3 py-1 text-xs border border-warm-300 rounded hover:bg-warm-50"
                >
                  100%
                </button>
              </div>
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-2">
              Remarks (optional)
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Add any notes or comments..."
              rows={3}
              className="w-full px-4 py-3 border border-warm-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
            />
          </div>
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setShowModal(false);
              setRemarks('');
              setApprovedMinutes(record.otMinutesCalculated);
            }}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            loading={loading}
            className="bg-orange-600 hover:bg-orange-700"
          >
            Approve {formatMinutesToHours(approvedMinutes)}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
