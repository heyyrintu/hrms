"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  FormGrid,
  Input,
  Modal,
  ModalFooter,
  PageLoader,
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
  type ProjectMember,
  type ProjectStatus,
  type ProjectTask,
} from "@/lib/api-projects";
import {
  utilisationApi,
  type EmployeeUtilisationRow,
} from "@/lib/api-utilisation";
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_VARIANT,
  apiErrorMessage,
  monthStartIso,
  todayIso,
  toEmployeeOptions,
  type EmployeeOption,
} from "../project-ui";

type TabKey = "overview" | "members" | "tasks" | "hours";

const STATUSES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"];

const num = (n: number) => String(Math.round(n * 100) / 100);
const pct = (n: number | null) => (n == null ? "-" : `${num(n)}%`);

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { hasRole, hasPermission } = useAuth();
  const isAdmin =
    hasRole(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN) ||
    !!hasPermission?.("projects.manage");

  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [p, m, t] = await Promise.all([
        projectsApi.get(id),
        projectsApi.listMembers(id),
        projectsApi.listTasks(id),
      ]);
      setProject(p.data);
      setMembers(m.data);
      setTasks(t.data);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setLoadError(
        status === 404
          ? "Project not found"
          : apiErrorMessage(err, "The project could not be loaded"),
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const ensureEmployees = async () => {
    if (employees.length > 0) return;
    try {
      const res = await employeesApi.getAll({ limit: 500, status: "ACTIVE" });
      setEmployees(toEmployeeOptions(res.data));
    } catch {
      toast.error("Failed to load employees");
    }
  };

  if (loading && !project) return <PageLoader />;

  if (loadError || !project) {
    return (
      <div className="space-y-3">
        <Link href="/projects" className="text-sm text-primary-700 hover:underline">
          Back to projects
        </Link>
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {loadError ?? "The project could not be loaded"}
        </div>
      </div>
    );
  }

  const canManage = project.canManage;
  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "members", label: "Members" },
    { key: "tasks", label: "Tasks" },
    ...(canManage ? [{ key: "hours" as TabKey, label: "Hours" }] : []),
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-sm text-primary-700 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-semibold text-warm-900">{project.name}</h1>
          <span className="font-mono text-xs text-warm-500">{project.code}</span>
          <Badge variant={PROJECT_STATUS_VARIANT[project.status]}>
            {PROJECT_STATUS_LABEL[project.status]}
          </Badge>
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-warm-200 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={
              "px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px " +
              (tab === t.key
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-warm-500 hover:text-warm-800")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          project={project}
          isAdmin={isAdmin}
          employees={employees}
          ensureEmployees={ensureEmployees}
          onSaved={(p) => setProject(p)}
        />
      )}
      {tab === "members" && (
        <MembersTab
          projectId={id}
          members={members}
          canManage={canManage}
          employees={employees}
          ensureEmployees={ensureEmployees}
          reload={load}
        />
      )}
      {tab === "tasks" && (
        <TasksTab projectId={id} tasks={tasks} canManage={canManage} reload={load} />
      )}
      {tab === "hours" && canManage && <HoursTab projectId={id} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-warm-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-warm-900">{children}</dd>
    </div>
  );
}

function OverviewTab({
  project,
  isAdmin,
  employees,
  ensureEmployees,
  onSaved,
}: {
  project: Project;
  isAdmin: boolean;
  employees: EmployeeOption[];
  ensureEmployees: () => Promise<void>;
  onSaved: (p: Project) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: project.name,
    clientName: project.clientName ?? "",
    description: project.description ?? "",
    status: project.status,
    billable: project.billable,
    startDate: project.startDate ?? "",
    endDate: project.endDate ?? "",
    managerEmployeeId: project.managerEmployeeId ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setForm({
      name: project.name,
      clientName: project.clientName ?? "",
      description: project.description ?? "",
      status: project.status,
      billable: project.billable,
      startDate: project.startDate ?? "",
      endDate: project.endDate ?? "",
      managerEmployeeId: project.managerEmployeeId ?? "",
    });
    setError(null);
    setEditing(true);
    await ensureEmployees();
  };

  const save = async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setError("End date must not be before the start date");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await projectsApi.update(project.id, {
        name: form.name.trim(),
        clientName: form.clientName.trim() || undefined,
        description: form.description.trim() || undefined,
        status: form.status,
        billable: form.billable,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        managerEmployeeId: form.managerEmployeeId || null,
      });
      onSaved(res.data);
      toast.success("Project updated");
      setEditing(false);
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to update project"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client">{project.clientName ?? "-"}</Field>
          <Field label="Manager">{project.manager?.name ?? "-"}</Field>
          <Field label="Start">{project.startDate ?? "-"}</Field>
          <Field label="End">{project.endDate ?? "-"}</Field>
          <Field label="Billable">{project.billable ? "Yes" : "No"}</Field>
          <Field label="Members / tasks">
            {project.memberCount} / {project.taskCount}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description">{project.description ?? "-"}</Field>
          </div>
        </dl>
        {isAdmin && (
          <div className="mt-4">
            <Button variant="secondary" onClick={open}>
              Edit project
            </Button>
          </div>
        )}
        <Modal isOpen={editing} onClose={() => setEditing(false)} title="Edit project" size="lg">
          <FormGrid cols={2}>
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label="Client"
              value={form.clientName}
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            />
            <Select
              label="Project status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <Select
              label="Manager"
              value={form.managerEmployeeId}
              onChange={(e) => setForm({ ...form, managerEmployeeId: e.target.value })}
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
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
            <Input
              label="End date"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            />
          </FormGrid>
          <label className="mt-3 flex items-center gap-2 text-sm text-warm-700">
            <input
              type="checkbox"
              checked={form.billable}
              onChange={(e) => setForm({ ...form, billable: e.target.checked })}
            />
            Billable
          </label>
          <div className="mt-3">
            <Input
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <ModalFooter>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save changes
            </Button>
          </ModalFooter>
        </Modal>
      </CardContent>
    </Card>
  );
}

function MembersTab({
  projectId,
  members,
  canManage,
  employees,
  ensureEmployees,
  reload,
}: {
  projectId: string;
  members: ProjectMember[];
  canManage: boolean;
  employees: EmployeeOption[];
  ensureEmployees: () => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [role, setRole] = useState("");
  const [startDate, setStartDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const available = useMemo(() => {
    const taken = new Set(members.map((m) => m.employeeId));
    return employees.filter((e) => !taken.has(e.id));
  }, [employees, members]);

  const openAdd = async () => {
    setEmployeeId("");
    setRole("");
    setStartDate("");
    setError(null);
    setAdding(true);
    await ensureEmployees();
  };

  const add = async () => {
    if (!employeeId) {
      setError("Choose an employee");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await projectsApi.addMember(projectId, {
        employeeId,
        ...(role.trim() ? { role: role.trim() } : {}),
        ...(startDate ? { startDate } : {}),
      });
      toast.success("Member added");
      setAdding(false);
      await reload();
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to add member"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (m: ProjectMember) => {
    try {
      const res = await projectsApi.removeMember(projectId, m.id);
      toast.success(
        res.data.ended ? "Membership ended (hours already logged)" : "Member removed",
      );
      await reload();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Failed to remove member"));
    }
  };

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add member
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            {canManage && <TableHead>Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableEmptyState colSpan={canManage ? 5 : 4} message="No members yet" />
          ) : (
            members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  {m.employee.name}{" "}
                  <span className="text-xs text-warm-500">{m.employee.code}</span>
                </TableCell>
                <TableCell>{m.role ?? "-"}</TableCell>
                <TableCell>{m.startDate}</TableCell>
                <TableCell>{m.endDate ?? "Open"}</TableCell>
                {canManage && (
                  <TableCell>
                    <button
                      aria-label={`Remove ${m.employee.name}`}
                      onClick={() => void remove(m)}
                      className="p-1.5 rounded text-warm-500 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add member">
        <div className="space-y-3">
          <Select label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select an employee</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
          <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} />
          <Input
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button onClick={add} loading={saving}>
            Add
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function TasksTab({
  projectId,
  tasks,
  canManage,
  reload,
}: {
  projectId: string;
  tasks: ProjectTask[];
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [estimate, setEstimate] = useState("");
  const [billable, setBillable] = useState<"inherit" | "yes" | "no">("inherit");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      setError("Task name is required");
      return;
    }
    const est = estimate.trim() === "" ? null : Number(estimate);
    if (est != null && (!Number.isFinite(est) || est < 0)) {
      setError("Estimate must be a positive number of hours");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await projectsApi.createTask(projectId, {
        name: name.trim(),
        billable: billable === "inherit" ? null : billable === "yes",
        estimateHours: est,
      });
      toast.success("Task created");
      setAdding(false);
      setName("");
      setEstimate("");
      setBillable("inherit");
      await reload();
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to create task"));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: ProjectTask) => {
    try {
      await projectsApi.updateTask(projectId, t.id, {
        status: t.status === "OPEN" ? "CLOSED" : "OPEN",
      });
      await reload();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Failed to update task"));
    }
  };

  const remove = async (t: ProjectTask) => {
    try {
      await projectsApi.deleteTask(projectId, t.id);
      toast.success("Task deleted");
      await reload();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Failed to delete task"));
    }
  };

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add task
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Billable</TableHead>
            <TableHead>Estimate (h)</TableHead>
            <TableHead>Status</TableHead>
            {canManage && <TableHead>Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.length === 0 ? (
            <TableEmptyState colSpan={canManage ? 5 : 4} message="No tasks yet" />
          ) : (
            tasks.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell>
                  {t.effectiveBillable ? "Yes" : "No"}
                  {t.billable === null && (
                    <span className="text-xs text-warm-500"> (project default)</span>
                  )}
                </TableCell>
                <TableCell>{t.estimateHours ?? "-"}</TableCell>
                <TableCell>
                  <Badge variant={t.status === "OPEN" ? "success" : "gray"}>
                    {t.status === "OPEN" ? "Open" : "Closed"}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`${t.status === "OPEN" ? "Close" : "Reopen"} ${t.name}`}
                        onClick={() => void toggle(t)}
                      >
                        {t.status === "OPEN" ? "Close" : "Reopen"}
                      </Button>
                      <button
                        aria-label={`Delete ${t.name}`}
                        onClick={() => void remove(t)}
                        className="p-1.5 rounded text-warm-500 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add task">
        <div className="space-y-3">
          <Input label="Task name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Estimate (hours)"
            type="number"
            min="0"
            step="0.25"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
          />
          <Select
            label="Billable"
            value={billable}
            onChange={(e) => setBillable(e.target.value as "inherit" | "yes" | "no")}
          >
            <option value="inherit">Same as project</option>
            <option value="yes">Billable</option>
            <option value="no">Non-billable</option>
          </Select>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button onClick={create} loading={saving}>
            Create task
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function HoursTab({ projectId }: { projectId: string }) {
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<EmployeeUtilisationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await utilisationApi.get({
        groupBy: "employee",
        projectId,
        from,
        to,
      });
      setRows(res.data.rows as EmployeeUtilisationRow[]);
    } catch (err) {
      setError(apiErrorMessage(err, "Failed to load hours"));
    } finally {
      setLoading(false);
    }
  }, [projectId, from, to]);

  useEffect(() => {
    if (from && to && from <= to) void load();
  }, [load, from, to]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {from > to && (
        <p className="text-sm text-red-600">The start date must not be after the end date</p>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Capacity (h)</TableHead>
            <TableHead>Logged (h)</TableHead>
            <TableHead>Billable (h)</TableHead>
            <TableHead>Utilisation</TableHead>
            <TableHead>Billable %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoadingState colSpan={6} />
          ) : rows.length === 0 ? (
            <TableEmptyState
              colSpan={6}
              message={error ? "Hours could not be loaded" : "No hours logged in this period"}
            />
          ) : (
            rows.map((r) => (
              <TableRow key={r.employeeId}>
                <TableCell>{r.name}</TableCell>
                <TableCell>{num(r.capacityHours)}</TableCell>
                <TableCell>{num(r.loggedHours)}</TableCell>
                <TableCell>{num(r.billableHours)}</TableCell>
                <TableCell>{pct(r.utilisationPct)}</TableCell>
                <TableCell>{pct(r.billablePct)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
