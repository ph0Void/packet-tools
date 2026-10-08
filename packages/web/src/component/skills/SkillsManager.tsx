"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  createSkill,
  deleteSkill,
  updateSkill,
  type Skill,
} from "@/service/SkillService";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SkillsManagerProps {
  initialSkills: Skill[];
  canEdit: boolean;
  canDelete: boolean;
}

interface FormState {
  id: string | null;
  title: string;
  description: string;
  content: string;
}

const FORM_VACIO: FormState = {
  id: null,
  title: "",
  description: "",
  content: "",
};

export default function SkillsManager({
  initialSkills,
  canEdit,
  canDelete,
}: SkillsManagerProps) {
  const router = useRouter();
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [form, setForm] = useState<FormState | null>(null);
  const [guardando, setGuardando] = useState(false);

  const abrirNueva = () =>
    setForm({ ...FORM_VACIO, content: "# Cuándo usarla\n\n# Pasos\n\n1. " });

  const abrirEdicion = (skill: Skill) =>
    setForm({
      id: skill.id,
      title: skill.title,
      description: skill.description ?? "",
      content: skill.content,
    });

  const cerrar = () => setForm(null);

  const guardar = async () => {
    if (!form) return;
    if (!form.title.trim() || !form.content.trim()) {
      toast.error("El título y el contenido son obligatorios.");
      return;
    }
    setGuardando(true);
    try {
      if (form.id) {
        const res = await updateSkill(form.id, {
          title: form.title.trim(),
          description: form.description.trim() || null,
          content: form.content,
        });
        if (res.success && res.data) {
          setSkills((prev) =>
            prev.map((s) => (s.id === form.id ? (res.data as Skill) : s)),
          );
          toast.success("Skill actualizada.");
        } else {
          toast.error(res.message || "No se pudo actualizar la skill.");
        }
      } else {
        const res = await createSkill({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          content: form.content,
        });
        if (res.success && res.data) {
          setSkills((prev) => [res.data as Skill, ...prev]);
          toast.success(
            "Skill creada. El agente la cargará cuando la necesite.",
          );
        } else {
          toast.error(res.message || "No se pudo crear la skill.");
        }
      }
      cerrar();
      router.refresh();
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (skill: Skill) => {
    const res = await deleteSkill(skill.id);
    if (res.success) {
      setSkills((prev) => prev.filter((s) => s.id !== skill.id));
      toast.success("Skill eliminada.");
      router.refresh();
    } else {
      toast.error(res.message || "No se pudo eliminar la skill.");
    }
  };

  return (
    <div className="space-y-4">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/40 bg-muted/30 p-4 md:p-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BookOpen className="h-5 w-5 text-primary" />
            Skills
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Gestiona las skills reutilizables que el agente ejecuta bajo
            demanda.
          </p>
        </div>

        {canEdit && !form && (
          <Button
            onClick={abrirNueva}
            className="gap-2 self-start sm:self-auto shrink-0"
          >
            <Plus className="h-4 w-4" />
            Nueva skill
          </Button>
        )}
      </div>

      {form && (
        <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {form.id ? "Editar skill" : "Nueva skill"}
            </h2>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={cerrar}
              className="cursor-pointer"
              aria-label="Cerrar"
            >
              <X className="size-3.5" />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Título
              </label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Configurar OSPF área 0"
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Cuándo usarla
              </label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Una frase: para qué sirve y cuándo aplicarla"
                className="text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Contenido (Markdown)
            </label>
            <Textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={14}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              El agente recibe solo el título y la descripción; el contenido se
              lee bajo demanda, así que conviene que sea preciso y accionable.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={cerrar}
              className="cursor-pointer"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={guardar}
              disabled={guardando}
              className="cursor-pointer"
            >
              <Save className="size-3.5" />
              {form.id ? "Guardar cambios" : "Crear skill"}
            </Button>
          </div>
        </div>
      )}

      {skills.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
          <BookOpen className="mx-auto mb-2 size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Todavía no hay skills.
          </p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            Pídele al agente en el chat: «crea una skill para configurar VLANs».
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {skills.map((skill) => (
            <li
              key={skill.id}
              className="rounded-lg border border-border/60 bg-card/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {skill.title}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      /skills/
                    </Badge>
                  </div>
                  {skill.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {skill.description}
                    </p>
                  )}
                  <p className="mt-1 line-clamp-2 font-mono text-[10px] text-muted-foreground/70">
                    {skill.content.slice(0, 160)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => abrirEdicion(skill)}
                      className="cursor-pointer"
                      aria-label={`Editar ${skill.title}`}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => eliminar(skill)}
                      className="cursor-pointer text-red-500 hover:text-red-600"
                      aria-label={`Eliminar ${skill.title}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
