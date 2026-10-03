"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { FolderKanban, Plus, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  FormGrid,
  Input,
  Modal,
  ModalFooter,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHead,
  TableHeader,
  TableLoadingState,
  TableRow,
} from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { UserRole } from "@/types";
import { employeesApi } from "@/lib/api";
import {
  projectsApi,
  type Project,
  type ProjectStatus,
} from "@/lib/api-projects";
import {
  CODE_ERROR,
  PROJECT_CODE_RE,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_VARIANT,
  apiErrorMessage,
  type EmployeeOption,
  toEmployeeOptions,
} from "./project-ui";

const PAGE_SIZE = 20;
const STATUSES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"];

interface FormState {
  code: string;
  name: string;
  clientName: string;
  description: string;
  billable: boolean;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  managerEmployeeId: string;
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  clientName: "",
  description: "",
  billable: true,
  status: "ACTIVE",
  startDate: "",
  endDate: "",
  managerEmployeeId: "",
};

export default function ProjectsPage() {
  const { hasRole, hasPermission } = useAuth();
  const isAdmin =
    hasRole(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN) ||
    !!hasPermission?.("projects.manage");

  const [rows, setRows] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await projectsApi.list({
        page,
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
      });
      setRows(res.data.data);
      setTotal(res.data.meta.total);
      setTotalPages(Math.max(1, res.data.meta.totalPages));
    } catch (err) {
      const message = apiErrorMessage(err, "Failed to load projects");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = async () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowCreate(true);
    if (employees.length === 0) {
      try {
        const res = await employeesApi.getAll({ limit: 500, status: "ACTIVE" });
        setEmployees(toEmployeeOptions(res.data));
      } catch {
        toast.error("Failed to load employees");
      }
    }
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const code = form.code.trim().toUpperCase();
    if (!PROJECT_CODE_RE.test(code)) {
      setFormError(CODE_ERROR);
      return;
    }
    if (!form.name.trim()) {
      setFormError("Name is required");
      return;
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setFormError("End date must not be before the start date");
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      await projectsApi.create({
        code,
        name: form.name.trim(),
        ...(form.clientName.trim() ? { clientName: form.clientName.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        billable: form.billable,
        status: form.status,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        managerEmployeeId: form.managerEmployeeId || null,
      });
      toast.success("Project created");
      setShowCreate(false);
      setPage(1);
      await load();
    } catch (err) {
      setFormError(apiErrorMessage(err, "Failed to create project"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-6 w-6 text-primary-600" />
          <h1 className="text-xl sm:text-2xl font-semibold text-warm-900">Projects</h1>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1.5" />
            New project
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2 relative">
            <Input
              label="Search projects"
              placeholder="Name, code or client"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Search className="pointer-events-none absolute right-3 bottom-3 h-4 w-4 text-warm-400" />
          </div>
          <Select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ProjectStatus | "");
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      {error && !loading && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}{" "}
          <button className="underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Project</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Manager</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Members</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoadingState colSpan={6} />
          ) : rows.length === 0 ? (
            <TableEmptyState
              colSpan={6}
              message={error ? "Projects could not be loaded" : "No projects found"}
            />
          ) : (
            rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.code}</TableCell>
                <TableCell>
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-medium text-primary-700 hover:underline"
                  >
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell>{p.clientName ?? "-"}</TableCell>
                <TableCell>{p.manager?.name ?? "-"}</TableCell>
                <TableCell>
                  <Badge variant={PROJECT_STATUS_VARIANT[p.status]}>
                    {PROJECT_STATUS_LABEL[p.status]}
                  </Badge>
                </TableCell>
                <TableCell>{p.memberCount}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-warm-600">
          <span>
            {total} projects, page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New project" size="lg">
        <FormGrid cols={2}>
          <Input
            label="Code"
            value={form.code}
            onChange={(e) => set("code", e.target.value)}
            placeholder="ACME-01"
          />
          <Input label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <Input
            label="Client"
            value={form.clientName}
            onChange={(e) => set("clientName", e.target.value)}
          />
          <Select
            label="Manager"
            value={form.managerEmployeeId}
            onChange={(e) => set("managerEmployeeId", e.target.value)}
          >
            <option value="">No manager</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
          <Input
            label="Start date"
            type="date"
            value={form.startDate}
            onChange={(e) => set("startDate", e.target.value)}
          />
          <Input
            label="End date"
            type="date"
            value={form.endDate}
            onChange={(e) => set("endDate", e.target.value)}
          />
          <Select
            label="Project status"
            value={form.status}
            onChange={(e) => set("status", e.target.value as ProjectStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-warm-700 self-end pb-2.5">
            <input
              type="checkbox"
              checked={form.billable}
              onChange={(e) => set("billable", e.target.checked)}
            />
            Billable
          </label>
        </FormGrid>
        <div className="mt-3">
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        {formError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {formError}
          </p>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowCreate(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Create project
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
