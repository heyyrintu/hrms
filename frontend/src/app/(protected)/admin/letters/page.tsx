'use client';

import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { lettersApi, employeesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  FileText,
  Search,
  Send,
  Download,
  Eye,
} from 'lucide-react';
import { LetterType } from '@/types';
import type { LetterTemplate, LetterGenerated, Employee } from '@/types';
import toast from 'react-hot-toast';

const letterTypeOptions = Object.values(LetterType).map((t) => ({
  value: t,
  label: t.replace(/_/g, ' '),
}));

const letterTypeColors: Record<string, string> = {
  OFFER_LETTER: 'success',
  APPOINTMENT_LETTER: 'info',
  INCREMENT_LETTER: 'success',
  CONFIRMATION_LETTER: 'info',
  RELIEVING_LETTER: 'warning',
  EXPERIENCE_LETTER: 'info',
  TRANSFER_LETTER: 'gray',
  PROMOTION_LETTER: 'success',
  WARNING_LETTER: 'warning',
  TERMINATION_LETTER: 'danger',
  OTHER: 'gray',
};

const defaultTemplateContent = `<p>Date: {{currentDate}}</p>
<p>To,<br/>{{employeeName}}<br/>{{designation}}<br/>{{department}}</p>
<p>Subject: </p>
<p>Dear {{firstName}},</p>
<p>This is to certify that...</p>
<p>Company: {{companyName}}<br/>{{companyAddress}}</p>
<p>Best regards,<br/>HR Department</p>`;

const emptyTemplateForm = {
  name: '',
  type: LetterType.OTHER as LetterType,
  content: defaultTemplateContent,
  description: '',
};

type TabKey = 'templates' | 'generated';

export default function LettersAdminPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('templates');
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [generated, setGenerated] = useState<LetterGenerated[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Template modal
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LetterTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState(emptyTemplateForm);
  const [saving, setSaving] = useState(false);

  // Delete modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<LetterTemplate | null>(null);

  // Generate modal
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({ templateId: '', employeeId: '' });

  // Preview modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewLetter, setPreviewLetter] = useState<LetterGenerated | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [tRes, gRes, eRes] = await Promise.all([
        lettersApi.getTemplates(),
        lettersApi.getGenerated(),
        employeesApi.getAll({ limit: 500 }),
      ]);
      setTemplates(tRes.data);
      setGenerated(gRes.data);
      setEmployees(eRes.data.data || eRes.data || []);
    } catch (error) {
      console.error('Failed to load letters data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // ── Template CRUD ────────────────────

  const openCreateTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm(emptyTemplateForm);
    setTemplateModalOpen(true);
  };

  const openEditTemplate = (template: LetterTemplate) => {
    setEditingTemplate(template);
    setTemplateForm({
      name: template.name,
      type: template.type,
      content: template.content,
      description: template.description || '',
    });
    setTemplateModalOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.content.trim()) {
      toast.error('Name and content are required');
      return;
    }
    setSaving(true);
    try {
      if (editingTemplate) {
        await lettersApi.updateTemplate(editingTemplate.id, templateForm);
        toast.success('Template updated');
      } else {
        await lettersApi.createTemplate(templateForm);
        toast.success('Template created');
      }
      setTemplateModalOpen(false);
      await loadData();
    } catch (error) {
      console.error('Failed to save template:', error);
      toast.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deletingTemplate) return;
    setSaving(true);
    try {
      await lettersApi.deleteTemplate(deletingTemplate.id);
      toast.success('Template deleted');
      setDeleteModalOpen(false);
      setDeletingTemplate(null);
      await loadData();
    } catch (error) {
      console.error('Failed to delete template:', error);
      toast.error('Failed to delete template');
    } finally {
      setSaving(false);
    }
  };

  // ── Letter Generation ────────────────

  const openGenerateModal = () => {
    setGenerateForm({
      templateId: templates.find((t) => t.isActive)?.id || '',
      employeeId: '',
    });
    setGenerateModalOpen(true);
  };

  const handleGenerate = async () => {
    if (!generateForm.templateId || !generateForm.employeeId) {
      toast.error('Select both template and employee');
      return;
    }
    setSaving(true);
    try {
      await lettersApi.generate(generateForm);
      toast.success('Letter generated successfully');
      setGenerateModalOpen(false);
      await loadData();
      setActiveTab('generated');
    } catch (error) {
      console.error('Failed to generate letter:', error);
      toast.error('Failed to generate letter');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async (letter: LetterGenerated) => {
    try {
      const empName = letter.employee
        ? `${letter.employee.firstName}-${letter.employee.lastName}`
        : 'letter';
      const typeName = letter.template?.type?.replace(/_/g, '-').toLowerCase() || 'letter';
      await lettersApi.downloadPdf(letter.id, `${typeName}-${empName}.pdf`);
    } catch (error) {
      console.error('Failed to download PDF:', error);
      toast.error('Failed to download PDF');
    }
  };

  const openPreview = async (letter: LetterGenerated) => {
    try {
      const res = await lettersApi.getGeneratedById(letter.id);
      setPreviewLetter(res.data);
      setPreviewModalOpen(true);
    } catch {
      toast.error('Failed to load letter');
    }
  };

  // ── Filters ──────────────────────────

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.type.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredGenerated = generated.filter((g) => {
    const empName = g.employee
      ? `${g.employee.firstName} ${g.employee.lastName} ${g.employee.employeeCode}`
      : '';
    return (
      empName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (g.template?.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const activeTemplates = templates.filter((t) => t.isActive);

  const sanitizeHtml = (html: string) => DOMPurify.sanitize(html);

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
              <FileText className="w-7 h-7 text-primary-600" />
              Letter Management
            </h1>
            <p className="text-warm-600 mt-1">
              Create templates and generate letters for employees
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={loadData} disabled={loading}>
              <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button variant="secondary" onClick={openGenerateModal}>
              <Send className="w-4 h-4 mr-2" />
              Generate Letter
            </Button>
            <Button onClick={openCreateTemplate}>
              <Plus className="w-4 h-4 mr-2" />
              New Template
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-warm-100 p-1 rounded-lg w-fit">
          {(['templates', 'generated'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-colors',
                activeTab === tab
                  ? 'bg-white text-warm-900 shadow-sm'
                  : 'text-warm-600 hover:text-warm-900',
              )}
            >
              {tab === 'templates' ? `Templates (${templates.length})` : `Generated (${generated.length})`}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
          <input
            type="text"
            placeholder={activeTab === 'templates' ? 'Search templates...' : 'Search generated letters...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-warm-900">{templates.length}</p>
              <p className="text-sm text-warm-500">Templates</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{activeTemplates.length}</p>
              <p className="text-sm text-warm-500">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-primary-600">{generated.length}</p>
              <p className="text-sm text-warm-500">Generated</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-warm-500">
                {new Set(generated.map((g) => g.employeeId)).size}
              </p>
              <p className="text-sm text-warm-500">Employees</p>
            </CardContent>
          </Card>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : activeTab === 'templates' ? (
          filteredTemplates.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <FileText className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-warm-900 mb-2">No Templates Found</h3>
                <p className="text-warm-600 mb-4">Create your first letter template to get started.</p>
                <Button onClick={openCreateTemplate}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Template
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredTemplates.map((template) => (
                <Card key={template.id}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-semibold text-warm-900">{template.name}</h3>
                          <Badge variant={letterTypeColors[template.type] as 'success' | 'info' | 'warning' | 'danger' | 'gray'}>
                            {template.type.replace(/_/g, ' ')}
                          </Badge>
                          <Badge variant={template.isActive ? 'success' : 'gray'}>
                            {template.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        {template.description && (
                          <p className="text-sm text-warm-600 mt-1">{template.description}</p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-warm-400">
                          <span>Created {formatDate(template.createdAt)}</span>
                          <span>Updated {formatDate(template.updatedAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => openEditTemplate(template)}
                          className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => { setDeletingTemplate(template); setDeleteModalOpen(true); }}
                          className="p-2 text-warm-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : filteredGenerated.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <FileText className="w-16 h-16 text-warm-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-warm-900 mb-2">No Letters Generated</h3>
              <p className="text-warm-600 mb-4">Generate a letter for an employee to get started.</p>
              <Button onClick={openGenerateModal}>
                <Send className="w-4 h-4 mr-2" />
                Generate Letter
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredGenerated.map((letter) => (
              <Card key={letter.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-warm-900">
                          {letter.employee
                            ? `${letter.employee.firstName} ${letter.employee.lastName}`
                            : 'Unknown'}
                        </h3>
                        {letter.employee?.employeeCode && (
                          <span className="text-xs text-warm-400">{letter.employee.employeeCode}</span>
                        )}
                        {letter.template && (
                          <Badge variant={letterTypeColors[letter.template.type] as 'success' | 'info' | 'warning' | 'danger' | 'gray'}>
                            {letter.template.type.replace(/_/g, ' ')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-warm-600 mt-1">
                        {letter.template?.name || 'Letter'} · {letter.employee?.department?.name || ''}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-warm-400">
                        <span>Generated {formatDate(letter.generatedAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openPreview(letter)}
                        className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDownloadPdf(letter)}
                        className="p-2 text-warm-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        title="Download PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Template Modal */}
      <Modal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        title={editingTemplate ? 'Edit Template' : 'New Template'}
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Name *</label>
            <input
              type="text"
              value={templateForm.name}
              onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
              placeholder="e.g. Standard Offer Letter"
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Letter Type</label>
              <select
                value={templateForm.type}
                onChange={(e) => setTemplateForm({ ...templateForm, type: e.target.value as LetterType })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                {letterTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Description</label>
              <input
                type="text"
                value={templateForm.description}
                onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
                placeholder="Brief description"
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Content * <span className="text-warm-400 font-normal">(Handlebars HTML)</span>
            </label>
            <textarea
              value={templateForm.content}
              onChange={(e) => setTemplateForm({ ...templateForm, content: e.target.value })}
              placeholder="Letter content with {{variables}}..."
              rows={12}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono text-sm resize-none"
            />
            <p className="text-xs text-warm-400 mt-1">
              Available variables: {'{{employeeName}}'}, {'{{firstName}}'}, {'{{lastName}}'}, {'{{employeeCode}}'}, {'{{designation}}'}, {'{{department}}'}, {'{{branch}}'}, {'{{email}}'}, {'{{joinDate}}'}, {'{{exitDate}}'}, {'{{companyName}}'}, {'{{companyAddress}}'}, {'{{currentDate}}'}, {'{{managerName}}'}
            </p>
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={() => setTemplateModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSaveTemplate} loading={saving} disabled={!templateForm.name || !templateForm.content}>
            {editingTemplate ? 'Update' : 'Create'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Template Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Template"
        size="sm"
      >
        <p className="text-warm-600">
          Are you sure you want to delete <strong>{deletingTemplate?.name}</strong>? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteTemplate} loading={saving}>
            Delete
          </Button>
        </ModalFooter>
      </Modal>

      {/* Generate Letter Modal */}
      <Modal
        isOpen={generateModalOpen}
        onClose={() => setGenerateModalOpen(false)}
        title="Generate Letter"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Template *</label>
            <select
              value={generateForm.templateId}
              onChange={(e) => setGenerateForm({ ...generateForm, templateId: e.target.value })}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select template...</option>
              {activeTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.type.replace(/_/g, ' ')})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Employee *</label>
            <select
              value={generateForm.employeeId}
              onChange={(e) => setGenerateForm({ ...generateForm, employeeId: e.target.value })}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select employee...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName} ({emp.employeeCode})
                </option>
              ))}
            </select>
          </div>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={() => setGenerateModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            loading={saving}
            disabled={!generateForm.templateId || !generateForm.employeeId}
          >
            <Send className="w-4 h-4 mr-2" />
            Generate
          </Button>
        </ModalFooter>
      </Modal>

      {/* Preview Modal */}
      <Modal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        title={previewLetter?.template?.name || 'Letter Preview'}
        size="lg"
      >
        {previewLetter && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-warm-500">
              <span>
                {previewLetter.employee?.firstName} {previewLetter.employee?.lastName}
              </span>
              <span>·</span>
              <Badge variant={letterTypeColors[previewLetter.template?.type || 'OTHER'] as 'success' | 'info' | 'warning' | 'danger' | 'gray'}>
                {previewLetter.template?.type.replace(/_/g, ' ')}
              </Badge>
            </div>
            <div
              className="prose prose-sm max-w-none p-4 bg-warm-50 rounded-lg border border-warm-200"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(previewLetter.content) }}
            />
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setPreviewModalOpen(false)}>
            Close
          </Button>
          {previewLetter && (
            <Button onClick={() => handleDownloadPdf(previewLetter)}>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </Button>
          )}
        </ModalFooter>
      </Modal>
    </>
  );
}
