"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { es } from "react-day-picker/locale";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarUI } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/FormatDate";
import type { CronJob, CronJobRunResult } from "@/service/CronJobService";
import {
  getJobScheduler,
  type InstantaneaPlanificador,
} from "@/service/JobSchedulerService";
import { runJobAction } from "@/action/CronJobAction";
import {
  comandosATexto,
  comandosQueCierranSesion,
  extraerComandos,
  MAX_COMANDOS_STANDARD,
  motivoDispositivoNoSoportado,
} from "@/component/jobs/comandosStandard";
import {
  Calendar as CalendarIcon,
  CalendarClock,
  Clock,
  Edit2,
  FileText,
  Play,
  Plus,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

export type CronJobRow = CronJob & {
  lastRun?: string | null;
  nextRun?: string | null;
  status?: string | null;
};

type DispositivoOpcional = {
  id: string;
  name: string;
  protocol: string;
  typeDevice: string;
};

interface CronJobManagerProps {
  initialJobs: CronJobRow[];
  topologies: { id: string; name: string }[];
  devices: DispositivoOpcional[];
  canManage: boolean;
}

type ActionType = "STANDARD" | "INTELLIGENT";

interface JobFormState {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  actionType: ActionType;
  scheduledDate: Date | undefined;
  scheduledTime: string;
  deviceProviderId: string;
  topologyId: string;
  isActive: boolean;

  commands: string;
}

const NONE = "__none__";

const EMPTY_FORM: JobFormState = {
  name: "",
  description: "",
  prompt: "",
  actionType: "INTELLIGENT",
  scheduledDate: undefined,
  scheduledTime: "02:00",
  deviceProviderId: "",
  topologyId: "",
  isActive: true,
  commands: "",
};

const ACTION_OPTIONS: {
  value: ActionType;
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: string;
}[] = [
    {
      value: "INTELLIGENT",
      label: "Inteligente (Prompt IA)",
      hint: "El agente de IA opera la red siguiendo tu prompt.",
      icon: Sparkles,
      accent: "text-violet-400",
    },
    {
      value: "STANDARD",
      label: "Estándar (Script / CLI)",
      hint: "Envía una lista de comandos a un dispositivo.",
      icon: Terminal,
      accent: "text-blue-400",
    },
  ];

const pad = (value: number) => String(value).padStart(2, "0");

function toTimeValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function combineDateTime(date: Date | undefined, time: string): Date | null {
  if (!date) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    0,
    0,
  );
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-500/30 bg-amber-500/15 text-amber-500",
  RUNNING: "border-cyan-500/30 bg-cyan-500/15 text-cyan-400",
  SUCCESS: "border-emerald-500/30 bg-emerald-500/15 text-emerald-500",
  FAILED: "border-red-500/30 bg-red-500/15 text-red-500",
  CANCEL: "border-border bg-muted text-muted-foreground",
};

function toJobPayload(
  form: JobFormState,
  includeScheduledAt: boolean,
): Record<string, unknown> {
  const scheduledAt = combineDateTime(form.scheduledDate, form.scheduledTime);
  const commands =
    form.actionType === "STANDARD" ? extraerComandos(form.commands) : [];
  return {
    name: form.name.trim(),
    actionType: form.actionType,
    isActive: form.isActive,
    ...(includeScheduledAt && scheduledAt
      ? { scheduledAt: scheduledAt.toISOString() }
      : {}),
    ...(form.description.trim()
      ? { description: form.description.trim() }
      : {}),
    ...(form.prompt.trim() ? { prompt: form.prompt.trim() } : {}),
    ...(commands.length > 0 ? { config: { commands } } : {}),
    ...(form.deviceProviderId
      ? { deviceProviderId: form.deviceProviderId }
      : {}),
    ...(form.topologyId ? { topologyId: form.topologyId } : {}),
  };
}

function textoResultadoEjecucion(
  resultado: CronJobRunResult | undefined,
): { ok: boolean; texto: string } {
  if (!resultado) {
    return { ok: false, texto: "La ejecución no devolvió resultado." };
  }
  if (resultado.ok) {
    return {
      ok: true,
      texto: `«${resultado.nombre}» ejecutada en ${resultado.duracionMs} ms.`,
    };
  }
  if (!resultado.ejecutado && resultado.error) {
    return { ok: false, texto: resultado.error };
  }
  return {
    ok: false,
    texto: resultado.error
      ? `Falló: ${resultado.error}`
      : `«${resultado.nombre}» terminó con error.`,
  };
}

function FormSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-b border-border/60 pb-6 last:border-b-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-7 text-foreground">
            {title}
          </h3>
          {description && (
            <p className="-mt-1 text-xs text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

const ALERT_TONES = {
  info: "border-border bg-muted/60 text-muted-foreground",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-500",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
} as const;

function InlineAlert({
  tone,
  icon: Icon = TriangleAlert,
  children,
}: {
  tone: keyof typeof ALERT_TONES;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-xs",
        ALERT_TONES[tone],
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function CronJobManager({
  initialJobs,
  topologies,
  devices,
  canManage,
}: CronJobManagerProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState<CronJobRow[]>(initialJobs);
  const [prevInitialJobs, setPrevInitialJobs] =
    useState<CronJobRow[]>(initialJobs);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CronJobRow | null>(null);
  const [form, setForm] = useState<JobFormState>(EMPTY_FORM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const [planificador, setPlanificador] = useState<
    InstantaneaPlanificador[] | null
  >(null);

  if (prevInitialJobs !== initialJobs) {
    setPrevInitialJobs(initialJobs);
    setJobs(initialJobs);
  }

  useEffect(() => {
    if (!canManage) return;
    let vivo = true;
    void getJobScheduler().then((res) => {
      if (vivo && res.success && res.data) setPlanificador(res.data);
    });
    return () => {
      vivo = false;
    };
  }, [canManage, initialJobs]);

  const automatizadasEnCurso = (planificador ?? []).filter(
    (fila) => fila.enEjecucion,
  ).length;

  const scheduledAt = combineDateTime(form.scheduledDate, form.scheduledTime);
  const isScheduledInPast = scheduledAt
    ? scheduledAt.getTime() <= now.getTime()
    : false;
  const today = now;
  const editingJob = form.id
    ? jobs.find((job) => job.id === form.id)
    : undefined;
  const originalScheduledAt = editingJob?.scheduledAt
    ? new Date(editingJob.scheduledAt).getTime()
    : null;
  const scheduledAtUnchanged =
    originalScheduledAt !== null &&
    scheduledAt?.getTime() === originalScheduledAt;
  const legacyCron =
    editingJob && !editingJob.scheduledAt ? editingJob.cronExpression : null;

  const esStandard = form.actionType === "STANDARD";
  const comandosFormulario = esStandard ? extraerComandos(form.commands) : [];
  const comandosDescartados = esStandard
    ? comandosQueCierranSesion(form.commands)
    : [];
  const dispositivoElegido = devices.find(
    (d) => d.id === form.deviceProviderId,
  );

  const avisoDispositivo =
    esStandard && dispositivoElegido
      ? motivoDispositivoNoSoportado(dispositivoElegido)
      : null;

  const updateForm = (patch: Partial<JobFormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  const changeActionType = (actionType: ActionType) =>
    updateForm({
      actionType,
      ...(actionType === "INTELLIGENT" ? { commands: "" } : {}),
    });

  const openCreateDialog = () => {
    setNow(new Date());
    setForm(EMPTY_FORM);
    setIsDateOpen(false);
    setIsDialogOpen(true);
  };

  const openEditDialog = (job: CronJobRow) => {
    const scheduled = job.scheduledAt ? new Date(job.scheduledAt) : null;
    const validScheduled =
      scheduled && !isNaN(scheduled.getTime()) ? scheduled : null;
    setForm({
      id: job.id,
      name: job.name,
      description: job.description ?? "",
      prompt: job.prompt ?? "",
      actionType: job.actionType,
      scheduledDate: validScheduled ?? undefined,
      scheduledTime: validScheduled ? toTimeValue(validScheduled) : "02:00",
      deviceProviderId: job.deviceProviderId ?? "",
      topologyId: job.topologyId ?? "",
      isActive: job.isActive,

      commands: comandosATexto(extraerComandos(job.payload)),
    });
    setNow(new Date());
    setIsDateOpen(false);
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    const name = form.name.trim();

    if (!name) {
      toast.error("El nombre de la tarea es obligatorio.");
      return;
    }
    if (!form.id && !scheduledAt) {
      toast.error("Selecciona la fecha y hora de ejecución.");
      return;
    }
    if (form.scheduledDate && !scheduledAt) {
      toast.error("Indica una hora de ejecución válida (HH:mm).");
      return;
    }
    const isPastSchedule = Boolean(
      scheduledAt && scheduledAt.getTime() <= new Date().getTime(),
    );
    if (isPastSchedule && !scheduledAtUnchanged) {
      toast.error("La fecha debe ser futura.");
      return;
    }
    if (
      isPastSchedule &&
      scheduledAtUnchanged &&
      form.isActive &&
      !editingJob?.isActive
    ) {
      toast.error(
        "Esta tarea ya venció. Selecciona una nueva fecha y hora para reactivarla.",
      );
      return;
    }

    if (form.actionType === "STANDARD") {
      if (comandosFormulario.length === 0) {
        toast.error(
          "Una automatización estándar necesita al menos un comando: sin ellos fallaría en cada ejecución.",
        );
        return;
      }
      if (comandosFormulario.length > MAX_COMANDOS_STANDARD) {
        toast.error(
          `El máximo es de ${MAX_COMANDOS_STANDARD} comandos por ejecución (has escrito ${comandosFormulario.length}).`,
        );
        return;
      }
      if (!form.deviceProviderId) {
        toast.error(
          "Selecciona el dispositivo que hay que comandar: es lo que dice a qué equipo se envían los comandos (una topología no basta).",
        );
        return;
      }
    }
    const includeScheduledAt = Boolean(scheduledAt) && !scheduledAtUnchanged;

    setBusyId(form.id ?? "new");
    try {
      const res = await fetch(form.id ? `/api/jobs/${form.id}` : "/api/jobs", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toJobPayload(form, includeScheduledAt)),
      });
      const data: {
        success: boolean;
        message: string;
        data: CronJobRow | null;
      } = await res.json();

      if (!data.success || !data.data) {
        toast.error(data.message || "Error al guardar la tarea.");
        return;
      }

      toast.success(
        form.id ? "Tarea actualizada." : "Tarea programada creada.",
      );
      setIsDialogOpen(false);

      const saved = data.data as CronJobRow;
      setJobs((prev) =>
        form.id
          ? prev.map((j) => (j.id === saved.id ? saved : j))
          : [saved, ...prev],
      );
      router.refresh();
    } catch {
      toast.error("Error al guardar la tarea.");
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (job: CronJobRow, active: boolean) => {
    const expiredOneTime =
      active &&
      job.scheduledAt &&
      new Date(job.scheduledAt).getTime() <= new Date().getTime();
    if (expiredOneTime) {
      toast.error(
        "Esta tarea de ejecución única ya venció. Edítala para elegir una nueva fecha.",
      );
      return;
    }
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, isActive: active } : j)),
    );
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: job.name,
          actionType: job.actionType,
          isActive: active,
          ...(active && job.scheduledAt
            ? { scheduledAt: job.scheduledAt }
            : {}),
          ...(job.description ? { description: job.description } : {}),
          ...(job.prompt ? { prompt: job.prompt } : {}),
          ...(job.deviceProviderId
            ? { deviceProviderId: job.deviceProviderId }
            : {}),
          ...(job.topologyId ? { topologyId: job.topologyId } : {}),
        }),
      });
      const data: { success: boolean; message: string } = await res.json();
      if (!data.success) {
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, isActive: !active } : j)),
        );
        toast.error(data.message || "Error actualizando el estado.");
        return;
      }
      toast.success(`Tarea ${active ? "activada" : "desactivada"}.`);
      router.refresh();
    } catch {
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, isActive: !active } : j)),
      );
      toast.error("Error actualizando el estado de la tarea.");
    }
  };

  const handleRun = async (id: string) => {
    setBusyId(id);
    try {
      const result = await runJobAction(id);
      const ejecucion = result.data;
      if (!result.success) {

        toast.error(result.message || "No se pudo ejecutar la tarea.");
        router.refresh();
        return;
      }

      const pintado = textoResultadoEjecucion(ejecucion);
      if (pintado.ok) {
        toast.success(pintado.texto);
      } else {
        toast.error(pintado.texto);
      }

      setJobs((prev) =>
        prev.map((j) =>
          j.id === id
            ? {
              ...j,
              status: ejecucion?.status ?? j.status,
              isActive:
                typeof ejecucion?.isActive === "boolean"
                  ? ejecucion.isActive
                  : j.isActive,
              nextRun: ejecucion?.nextRun ?? null,
              lastRun: new Date().toISOString(),
            }
            : j,
        ),
      );
      router.refresh();
    } catch {
      toast.error("Error al ejecutar la tarea.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      const res = await fetch(`/api/jobs/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data: { success: boolean; message: string } = await res.json();
      if (!data.success) {
        toast.error(data.message || "Error al eliminar.");
        return;
      }
      toast.success("Tarea eliminada.");
      setJobs((prev) => prev.filter((j) => j.id !== deleteTarget.id));
      router.refresh();
    } catch {
      toast.error("Error al eliminar la tarea.");
    } finally {
      setBusyId(null);
      setDeleteTarget(null);
    }
  };

  const isSaving = busyId === (form.id ?? "new");

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/40 bg-muted/30 p-4 md:p-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Clock className="h-5 w-5 text-primary" />
            Tareas y Automatizaciones
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Gestiona tareas programadas y ejecuciones manuales o impulsadas por
            IA.{" "}
          </p>

          {planificador && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                {planificador.length}{" "}
                {planificador.length === 1
                  ? "automatización programada"
                  : "automatizaciones programadas"}
              </span>
              {automatizadasEnCurso > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-cyan-400">
                    {automatizadasEnCurso} en ejecución
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        {canManage && (
          <Button
            onClick={openCreateDialog}
            className="cursor-pointer gap-2 self-start sm:self-auto shrink-0"
          >
            <Plus className="w-4 h-4" />
            Nueva Tarea
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
              <tr>
                <th className="p-4">Nombre de la Tarea</th>
                <th className="p-4">Tipo</th>
                <th className="p-4">Destino</th>
                <th className="p-4">Programación</th>
                <th className="p-4">Próxima Ejecución</th>
                <th className="p-4">Última Ejecución</th>
                <th className="p-4">Estado</th>
                <th className="p-4 text-center">Activo</th>
                {canManage && <th className="p-4 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.length === 0 ? (
                <tr>
                  <td
                    colSpan={canManage ? 9 : 8}
                    className="p-8 text-center text-muted-foreground"
                  >
                    No hay tareas o automatizaciones programadas.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const statusStyle =
                    STATUS_STYLES[job.status ?? ""] ?? STATUS_STYLES.CANCEL;
                  const enEjecucion =
                    planificador?.find((fila) => fila.id === job.id)
                      ?.enEjecucion ?? false;
                  return (
                    <tr
                      key={job.id}
                      className="transition-colors hover:bg-muted/30"
                    >
                      <td className="p-4 font-semibold text-foreground">
                        <div className="flex items-center gap-2">
                          {job.actionType === "INTELLIGENT" ? (
                            <Sparkles className="h-4 w-4 text-violet-400" />
                          ) : (
                            <Terminal className="h-4 w-4 text-blue-400" />
                          )}
                          <span>{job.name}</span>
                        </div>
                        {job.description && (
                          <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                            {job.description}
                          </p>
                        )}
                      </td>
                      <td className="p-4">
                        <Badge
                          variant="outline"
                          className={cn(
                            job.actionType === "INTELLIGENT"
                              ? "border-violet-500/30 bg-violet-500/15 text-violet-400"
                              : "border-blue-500/30 bg-blue-500/15 text-blue-400",
                          )}
                        >
                          {job.actionType}
                        </Badge>
                      </td>
                      <td className="max-w-40 truncate p-4 text-xs text-muted-foreground">
                        {job.deviceProvider?.name ?? "—"}
                        <br />
                        {job.topology?.name ?? "Sin topología"}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {job.scheduledAt ? (
                            <span className="text-xs whitespace-nowrap text-muted-foreground">
                              {formatDate(job.scheduledAt)}
                            </span>
                          ) : (
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                              {job.cronExpression}
                            </code>
                          )}
                          <Badge
                            variant="outline"
                            className={cn(
                              job.scheduledAt
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border bg-muted text-muted-foreground",
                            )}
                          >
                            {job.scheduledAt ? "Única" : "Recurrente"}
                          </Badge>
                        </div>
                      </td>
                      <td className="p-4 text-xs whitespace-nowrap text-muted-foreground">
                        {job.nextRun ? formatDate(job.nextRun) : "—"}
                      </td>
                      <td className="p-4 text-xs whitespace-nowrap text-muted-foreground">
                        {job.lastRun ? formatDate(job.lastRun) : "—"}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={statusStyle}>
                            {job.status ?? "PENDING"}
                          </Badge>

                          {enEjecucion && (
                            <Badge
                              variant="outline"
                              className="gap-1 border-cyan-500/30 bg-cyan-500/15 text-cyan-400"
                            >
                              <Spinner className="h-3 w-3" />
                              EN CURSO
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <Switch
                          className="cursor-pointer"
                          checked={job.isActive}
                          disabled={!canManage || busyId === job.id}
                          onCheckedChange={(checked) =>
                            handleToggleActive(job, checked)
                          }
                          aria-label={`Activar ${job.name}`}
                        />
                      </td>
                      {canManage && (
                        <td className="p-4 text-right">
                          <div className="inline-flex justify-end space-x-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="cursor-pointer"
                              title={
                                busyId === job.id
                                  ? "Ejecutando…"
                                  : "Ejecutar Ahora"
                              }
                              aria-busy={busyId === job.id}
                              disabled={busyId === job.id}
                              onClick={() => handleRun(job.id)}
                            >
                              {busyId === job.id ? (
                                <Spinner className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="cursor-pointer"
                              title="Editar"
                              disabled={busyId === job.id}
                              onClick={() => openEditDialog(job)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="cursor-pointer text-destructive hover:bg-destructive/10"
                              title="Eliminar"
                              disabled={busyId === job.id}
                              onClick={() => setDeleteTarget(job)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border px-6 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              {form.id ? "Editar Tarea Programada" : "Programar Nueva Tarea"}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Define qué se ejecuta, cuándo y sobre qué equipo.
            </p>
          </DialogHeader>

          <form
            onSubmit={handleSave}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-6 overflow-x-hidden overflow-y-auto px-6 py-5">

              <FormSection icon={FileText} title="Información general">
                <div className="grid gap-4 ">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="job-name">Nombre de la Tarea *</Label>
                    <Input
                      id="job-name"
                      placeholder="Ej: Backup nocturno del switch core"
                      value={form.name}
                      onChange={(e) => updateForm({ name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="job-description">Descripción Breve</Label>
                    <Textarea
                      id="job-description"
                      className="resize-none min-h-[60px]"
                      placeholder="Ej: Ejecuta respaldo de configuración a las 2 AM"
                      value={form.description}
                      onChange={(e) =>
                        updateForm({ description: e.target.value })
                      }
                    />
                  </div>
                </div>
              </FormSection>

              <FormSection
                icon={Sparkles}
                title="Tipo de acción"
                description="Define cómo se ejecuta la tarea."
              >
                <div
                  role="radiogroup"
                  aria-label="Tipo de acción"
                  className="grid gap-3 md:grid-cols-2"
                >
                  {ACTION_OPTIONS.map((option) => {
                    const selected = form.actionType === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => changeActionType(option.value)}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted/50",
                        )}
                      >
                        <Icon
                          className={cn("mt-0.5 h-4 w-4 shrink-0", option.accent)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {option.label}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {option.hint}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </FormSection>

              <FormSection
                icon={CalendarClock}
                title="Programación"
                description="La tarea se ejecuta una sola vez en la fecha y hora elegidas."
              >
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="min-w-0 space-y-2">
                    <Label id="job-date-label">Fecha de ejecución *</Label>
                    <Popover open={isDateOpen} onOpenChange={setIsDateOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full cursor-pointer justify-start gap-2 font-normal"
                          aria-labelledby="job-date-label"
                        >
                          <CalendarIcon className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {form.scheduledDate
                              ? formatDate(form.scheduledDate, "es-PE", {
                                dateStyle: "long",
                              })
                              : "Seleccionar fecha"}
                          </span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarUI
                          mode="single"
                          locale={es}
                          selected={form.scheduledDate}
                          onSelect={(date) => {
                            updateForm({ scheduledDate: date });
                            setIsDateOpen(false);
                          }}
                          disabled={{ before: today }}
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="job-time">Hora de ejecución *</Label>
                    <Input
                      id="job-time"
                      type="time"
                      className="cursor-pointer"
                      value={form.scheduledTime}
                      onChange={(e) =>
                        updateForm({ scheduledTime: e.target.value })
                      }
                    />
                  </div>

                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="job-active" className="cursor-pointer">
                      Estado
                    </Label>
                    <div className="flex h-9 items-center justify-between gap-3 rounded-md border border-border px-3">
                      <Label
                        htmlFor="job-active"
                        className="cursor-pointer text-sm font-normal"
                      >
                        Tarea activa
                      </Label>
                      <Switch

                        className="cursor-pointer"
                        checked={form.isActive}
                        onCheckedChange={(checked) =>
                          updateForm({ isActive: checked })
                        }
                        aria-label="Tarea activa"
                      />
                    </div>
                  </div>
                </div>

                {scheduledAt && !isScheduledInPast && (
                  <InlineAlert tone="info" icon={CalendarIcon}>
                    Se ejecutará una sola vez el{" "}
                    {formatDate(scheduledAt, "es-PE", {
                      dateStyle: "full",
                      timeStyle: "short",
                    })}
                  </InlineAlert>
                )}

                {isScheduledInPast && scheduledAtUnchanged && (
                  <InlineAlert tone="warning" icon={CalendarIcon}>
                    La programación ya venció; se conservará tal cual. Elige
                    una nueva fecha y hora para reprogramarla.
                  </InlineAlert>
                )}

                {isScheduledInPast && !scheduledAtUnchanged && (
                  <InlineAlert tone="danger" icon={CalendarIcon}>
                    La fecha debe ser futura.
                  </InlineAlert>
                )}

                {legacyCron && !form.scheduledDate && (
                  <InlineAlert tone="info" icon={CalendarIcon}>
                    Programación actual: recurrente (cron:{" "}
                    <code className="rounded bg-muted px-1 font-mono">
                      {legacyCron}
                    </code>
                    ). Selecciona fecha y hora para convertirla en ejecución
                    única.
                  </InlineAlert>
                )}
              </FormSection>

              <FormSection
                icon={Server}
                title="Destino"
                description="El dispositivo es obligatorio: es el equipo que recibe los comandos."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="min-w-0 space-y-2">
                    <Label>Dispositivo{esStandard ? " *" : ""}</Label>
                    <Select
                      value={form.deviceProviderId || NONE}
                      onValueChange={(val) =>
                        updateForm({
                          deviceProviderId: val === NONE ? "" : val,
                        })
                      }
                    >
                      <SelectTrigger className="w-full cursor-pointer">
                        <SelectValue
                          placeholder={
                            esStandard ? "Elige el equipo" : "Opcional"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE} className="cursor-pointer">
                          Sin dispositivo
                        </SelectItem>
                        {devices.map((d) => (
                          <SelectItem
                            key={d.id}
                            value={d.id}
                            className="cursor-pointer"
                          >
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                </div>

                {avisoDispositivo && (
                  <InlineAlert tone="danger">{avisoDispositivo}</InlineAlert>
                )}
              </FormSection>

              {esStandard ? (
                <FormSection
                  icon={Terminal}
                  title="Comandos a ejecutar *"
                  description="Uno por línea, en el orden en que se enviarán."
                >
                  <div className="space-y-2">
                    <Textarea
                      id="job-commands"
                      rows={7}
                      spellCheck={false}
                      className="font-mono text-sm min-h-[130px] "
                      placeholder={
                        "show version\nshow ip interface brief\nshow clock"
                      }
                      value={form.commands}
                      onChange={(e) =>
                        updateForm({ commands: e.target.value })
                      }
                      aria-label="Comandos a ejecutar"
                      aria-describedby="job-commands-help"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p
                        id="job-commands-help"
                        className="min-w-0 flex-1 text-muted-foreground"
                      >
                        Se ejecutan en el dispositivo elegido el{" "}
                        {scheduledAt
                          ? formatDate(scheduledAt, "es-PE", {
                            dateStyle: "long",
                            timeStyle: "short",
                          })
                          : "día y hora programados"}
                        , no en la consola del navegador.
                      </p>
                      <span
                        className={cn(
                          "shrink-0 tabular-nums",
                          comandosFormulario.length > MAX_COMANDOS_STANDARD
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {comandosFormulario.length} / {MAX_COMANDOS_STANDARD}{" "}
                        comandos
                      </span>
                    </div>

                    {comandosFormulario.length > MAX_COMANDOS_STANDARD && (
                      <InlineAlert tone="danger">
                        Llevas {comandosFormulario.length} comandos y el máximo
                        es {MAX_COMANDOS_STANDARD}.
                      </InlineAlert>
                    )}

                  </div>

                </FormSection>
              ) : (
                <>
                  <FormSection
                    icon={Sparkles}
                    title="Prompt del Agente de IA"
                    description="Indica qué debe hacer el agente cuando llegue la hora."
                  >
                    <Textarea
                      id="job-prompt"
                      rows={6}
                      className="resize-none min-h-[110px]"
                      placeholder="Ej: Realiza un ping entre los routers principales y genera un reporte..."
                      value={form.prompt}
                      onChange={(e) => updateForm({ prompt: e.target.value })}
                      aria-label="Prompt del Agente de IA"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p
                        id="job-commands-help"
                        className="min-w-0 flex-1 text-muted-foreground"
                      >
                        Se recomienda que el prompt sea conciso y claro para obtener mejores resultados.
                      </p>
                    </div>
                  </FormSection>
                </>
              )}
            </div>

            <DialogFooter className="gap-2 border-t border-border bg-muted/30 px-6 py-4 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => setIsDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="cursor-pointer gap-2"
                disabled={isSaving}
              >
                {isSaving && <Spinner className="h-4 w-4" />}
                Guardar Tarea
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar Tarea Programada</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ¿Seguro que deseas eliminar{" "}
            <span className="font-semibold text-foreground">
              {deleteTarget?.name}
            </span>
            ? Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => setDeleteTarget(null)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="cursor-pointer"
              disabled={!deleteTarget || busyId === deleteTarget.id}
              onClick={handleDelete}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
