import { resolveHandoffTarget, resolveTaskBrief } from "../deep/handoff";
import { SKILLS_ROOT } from "../skills/loader";

const WRITE_TODOS = "write_todos";
const TASK = "task";
const SEARCH_KB = "search_knowledge_base";
const READ_FILE = "read_file";

export type Emit = (event: string, data: unknown) => void;

type TodoStatus = "pending" | "in_progress" | "completed";

export function normalizarPlan(args: unknown): Array<{
  id: string;
  content: string;
  status: TodoStatus;
}> {
  const lista =
    Array.isArray(args)
      ? args
      : args && typeof args === "object" && Array.isArray((args as { todos?: unknown }).todos)
        ? ((args as { todos: unknown[] }).todos)
        : [];
  const pasos: Array<{ id: string; content: string; status: TodoStatus }> = [];
  lista.forEach((item, index) => {
    if (typeof item === "string" && item.trim()) {
      pasos.push({ id: `todo-${index}`, content: item.trim(), status: "pending" });
      return;
    }
    if (typeof item !== "object" || item === null) return;
    const t = item as Record<string, unknown>;
    const content = typeof t.content === "string" ? t.content.trim() : "";
    if (!content) return;
    const status: TodoStatus =
      t.status === "completed" || t.status === "in_progress" ? t.status : "pending";
    pasos.push({
      id: typeof t.id === "string" && t.id ? t.id : `todo-${index}`,
      content,
      status,
    });
  });
  return pasos;
}

export function extraerFuentesRag(output: string): string[] {
  try {
    const parsed = JSON.parse(output) as {
      documents?: unknown;
      metadatas?: Array<{ title?: unknown } | null>;
    };
    const metadatas = Array.isArray(parsed.metadatas) ? parsed.metadatas : [];
    const fuentes = metadatas
      .map((m) => (m && typeof m.title === "string" ? m.title : null))
      .filter((t): t is string => Boolean(t));
    if (fuentes.length > 0) return fuentes;

    if (Array.isArray(parsed.documents)) {
      return parsed.documents
        .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        .map((d) => d.slice(0, 80));
    }
    return [];
  } catch {
    return [];
  }
}

export function skillDePath(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith(`${SKILLS_ROOT}/`)) return null;
  const relativo = path.slice(SKILLS_ROOT.length + 1);
  const nombre = relativo.split("/")[0];
  return nombre && nombre !== "SKILL.md" ? nombre : null;
}

function resumenSubagente(output: string, max = 240): string {
  const limpio = output.replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
}

export function emitirTransparenciaAlIniciar(
  emit: Emit,
  toolName: string,
  input: Record<string, unknown>,
): void {
  if (toolName === WRITE_TODOS) {
    const todos = normalizarPlan(input);
    if (todos.length > 0) emit("plan_update", { todos });
    return;
  }
  if (toolName === TASK) {
    const target = resolveHandoffTarget(toolName, input);
    if (target) {
      emit("subagent_started", {
        name: String(input.subagent_type ?? target),
        task: resolveTaskBrief(input),
      });
    }
    return;
  }
  const skill = skillDePath(input.file_path ?? input.path);
  if (skill && toolName === READ_FILE) {
    emit("skill_loading", {
      skillName: skill,
      ...(typeof input.description === "string"
        ? { description: input.description }
        : {}),
    });
  }
}

export function emitirTransparenciaAlTerminar(
  emit: Emit,
  toolName: string,
  input: Record<string, unknown>,
  output: string,
  status: "completed" | "error" | "rejected",
): void {
  if (toolName === TASK) {
    const nombre = String(input.subagent_type ?? "general-purpose");
    if (status === "completed") {
      emit("subagent_completed", { name: nombre, summary: resumenSubagente(output) });
    } else {
      emit("subagent_completed", {
        name: nombre,
        summary:
          status === "rejected"
            ? "Acción cancelada por el usuario."
            : "La delegación terminó con error.",
      });
    }
    return;
  }
  if (toolName === SEARCH_KB && status === "completed") {
    const sources = extraerFuentesRag(output);
    if (sources.length > 0) {
      emit("rag_retrieved", { sources, chunksUsed: sources.length });
    }
    return;
  }
  const skill = skillDePath(input.file_path ?? input.path);
  if (skill && toolName === READ_FILE && status === "completed") {
    emit("skill_loaded", { skillName: skill });
  }
}
