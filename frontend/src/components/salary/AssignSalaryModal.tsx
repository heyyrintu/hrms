'use client';

import { useState, useEffect } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormRow, FormGrid, FormError } from '@/components/ui/FormRow';
import { SalaryStructureSelector } from './SalaryStructureSelector';
import { SalaryComponentsPreview } from './SalaryComponentsPreview';
import { SalaryStructure } from '@/types';
import { payrollApi } from '@/lib/api';
import toast from 'react-hot-toast';

interface AssignSalaryFormData {
  salaryStructureId: string;
  basePay: string;
  effectiveFrom: string;
  effectiveTo: string;
}

interface AssignSalaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  onSuccess: () => void;
  className?: string;
}

const emptyFormData: AssignSalaryFormData = {
  salaryStructureId: '',
  basePay: '',
  effectiveFrom: new Date().toISOString().split('T')[0],
  effectiveTo: '',
};

export function AssignSalaryModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  onSuccess,
  className,
}: AssignSalaryModalProps) {
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [loadingStructures, setLoadingStructures] = useState(false);
  const [formData, setFormData] = useState<AssignSalaryFormData>(emptyFormData);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const selectedStructure = structures.find((s) => s.id === formData.salaryStructureId);

  useEffect(() => {
    if (isOpen) {
      loadStructures();
      setFormData(emptyFormData);
      setValidationErrors({});
      setFormError('');
    }
  }, [isOpen]);

  const loadStructures = async () => {
    setLoadingStructures(true);
    try {
      const response = await payrollApi.getStructures();
      setStructures(response.data.filter((s: SalaryStructure) => s.isActive));
    } catch (error) {
      toast.error('Failed to load salary structures');
      console.error(error);
    } finally {
      setLoadingStructures(false);
    }
  };

  const handleInputChange = (field: keyof AssignSalaryFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
    setFormError('');
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.salaryStructureId) {
      errors.salaryStructureId = 'Please select a salary structure';
    }

    const basePay = parseFloat(formData.basePay);
    if (!formData.basePay || basePay <= 0) {
      errors.basePay = 'Base pay must be greater than 0';
    }

    if (!formData.effectiveFrom) {
      errors.effectiveFrom = 'Effective from date is required';
    }

    if (formData.effectiveTo && formData.effectiveFrom) {
      if (formData.effectiveTo <= formData.effectiveFrom) {
        errors.effectiveTo = 'Effective to must be after effective from';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    setFormError('');

    try {
      await payrollApi.assignSalary(employeeId, {
        salaryStructureId: formData.salaryStructureId,
        basePay: parseFloat(formData.basePay),
        effectiveFrom: formData.effectiveFrom,
        effectiveTo: formData.effectiveTo || undefined,
      });

      toast.success('Salary assigned successfully');
      onSuccess();
      onClose();
    } catch (error: any) {
      const message =
        error.response?.data?.message || 'Failed to assign salary';
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Salary" size="lg" className={className}>
      <form onSubmit={handleSubmit}>
        {/* Employee Info */}
        <div className="mb-4 p-3 bg-warm-50 rounded-lg">
          <p className="text-sm text-warm-600">Assigning salary for</p>
          <p className="font-medium text-warm-900">{employeeName}</p>
        </div>

        {/* Salary Structure Selector */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-warm-700 mb-2">
            Salary Structure <span className="text-primary-500">*</span>
          </label>
          <SalaryStructureSelector
            structures={structures}
            selectedId={formData.salaryStructureId}
            onChange={(id) => handleInputChange('salaryStructureId', id)}
            loading={loadingStructures}
          />
          {validationErrors.salaryStructureId && (
            <FormError message={validationErrors.salaryStructureId} />
          )}
        </div>

        {/* Base Pay */}
        <FormRow label="Monthly Base Pay" required error={validationErrors.basePay}>
          <Input
            type="number"
            value={formData.basePay}
            onChange={(e) => handleInputChange('basePay', e.target.value)}
            placeholder="Enter monthly base pay"
            min="0"
            step="100"
          />
        </FormRow>

        {/* Effective Dates */}
        <FormGrid cols={2}>
          <FormRow label="Effective From" required error={validationErrors.effectiveFrom}>
            <Input
              type="date"
              value={formData.effectiveFrom}
              onChange={(e) => handleInputChange('effectiveFrom', e.target.value)}
            />
          </FormRow>
          <FormRow label="Effective To" error={validationErrors.effectiveTo}>
            <Input
              type="date"
              value={formData.effectiveTo}
              onChange={(e) => handleInputChange('effectiveTo', e.target.value)}
              min={formData.effectiveFrom}
            />
          </FormRow>
        </FormGrid>

        <p className="text-xs text-warm-500 mb-4">
          Leave end date empty for ongoing assignments
        </p>

        {/* Salary Preview */}
        {selectedStructure && formData.basePay && parseFloat(formData.basePay) > 0 && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-medium mb-3 text-blue-900 text-sm">Salary Preview</h4>
            <SalaryComponentsPreview
              basePay={parseFloat(formData.basePay)}
              components={selectedStructure.components}
            />
          </div>
        )}

        {/* Form Error */}
        {formError && (
          <div className="mt-4">
            <FormError message={formError} />
          </div>
        )}

        {/* Actions */}
        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Assign Salary
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
