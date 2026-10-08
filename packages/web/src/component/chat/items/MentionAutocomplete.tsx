"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Globe, Radio, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeviceProvider } from "@/service/DeviceProviderService";

export const SKILL_PREFIX = "skill:";

export interface MentionItem {

  token: string;
  label: string;
  description: string;
  icon: React.ReactNode;

  group: "base" | "skill" | "dispositivo";
}

export interface MentionSkill {
  id: string;
  title: string;
  description: string | null;
}

export const MENCIONES_FIJAS: MentionItem[] = [
  {
    token: "rag",
    label: "rag",
    description: "Fuerza la búsqueda en la base de conocimiento",
    icon: <BookOpen className="size-3.5" />,
    group: "base",
  },
  {
    token: "web",
    label: "web",
    description: "Fuerza una búsqueda en internet",
    icon: <Globe className="size-3.5" />,
    group: "base",
  },
  {
    token: "skill:",
    label: "skill:",
    description: "Aplica una skill concreta (escribe el nombre)",
    icon: <Sparkles className="size-3.5" />,
    group: "base",
  },
];

export function detectarMencia(
  valor: string,
  cursor: number,
): { inicio: number; query: string } | null {
  const hasta = valor.slice(0, cursor);
  const arroba = hasta.lastIndexOf("@");
  if (arroba === -1) return null;
  const posterior = hasta.slice(arroba + 1);

  if (/[\s\n]/.test(posterior)) return null;
  if (posterior.length > 48) return null;
  return { inicio: arroba, query: posterior.toLowerCase() };
}

export function insertarMencia(
  valor: string,
  inicio: number,
  cursor: number,
  token: string,
): { texto: string; posicion: number } {
  const antes = valor.slice(0, inicio);
  const despues = valor.slice(cursor);
  const texto = `${antes}@${token} ${despues}`;
  return { texto, posicion: antes.length + token.length + 2 };
}

export function slugDeSkill(title: string): string {
  return String(title ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function useMentionCandidates(
  devices: DeviceProvider[],
  skills: MentionSkill[],
  query: string,
): MentionItem[] {
  return useMemo(() => {
    const itemsSkills: MentionItem[] = skills.map((skill) => {
      const slug = slugDeSkill(skill.title);
      return {
        token: `${SKILL_PREFIX}${slug}`,
        label: slug,
        description: skill.description || skill.title,
        icon: <Sparkles className="size-3.5" />,
        group: "skill" as const,
      };
    });

    const itemsDispositivos: MentionItem[] = devices
      .filter((d) => Boolean(d.name))
      .map((d) => ({
        token: d.name,
        label: d.name,
        description: `${d.protocol || "—"} · ${d.typeDevice || "dispositivo"}`,
        icon: <Radio className="size-3.5" />,
        group: "dispositivo" as const,
      }));

    const q = query.trim().toLowerCase();

    if (!q) {
      return [...MENCIONES_FIJAS, ...itemsSkills, ...itemsDispositivos].slice(0, 8);
    }

    if (q === "skill" || q.startsWith(SKILL_PREFIX)) {
      const resto = q.startsWith(SKILL_PREFIX) ? q.slice(SKILL_PREFIX.length) : "";
      return itemsSkills
        .filter((item) => item.label.includes(resto))
        .slice(0, 8);
    }

    return [...MENCIONES_FIJAS, ...itemsDispositivos]
      .filter((item) => item.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [devices, skills, query]);
}

const GRUPOS: Array<{ id: MentionItem["group"]; titulo: string }> = [
  { id: "base", titulo: "Búsqueda" },
  { id: "skill", titulo: "Skills" },
  { id: "dispositivo", titulo: "Dispositivos" },
];

export function MentionList({
  abierto,
  items,
  resaltado,
  onSelect,
  className,
}: {

  abierto: boolean;
  items: MentionItem[];
  resaltado: number;
  onSelect: (item: MentionItem) => void;
  className?: string;
}) {
  if (!abierto || items.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute bottom-full left-0 z-50 mb-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-lg border border-border/60 bg-popover p-1 shadow-lg",
        className,
      )}
      role="listbox"

      onMouseDown={(e) => e.preventDefault()}
    >
      {GRUPOS.map(({ id, titulo }) => {
        const delGrupo = items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.group === id);
        if (delGrupo.length === 0) return null;
        return (
          <div key={id} className="mb-1 last:mb-0">
            <p className="px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
              {titulo}
            </p>
            {delGrupo.map(({ item, index }) => (
              <button
                key={`${item.group}-${item.token}`}
                type="button"
                role="option"
                aria-selected={index === resaltado}
                onClick={() => onSelect(item)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  index === resaltado
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/60",
                )}
              >
                <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    @{item.label}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function useMentionAutocomplete(
  devices: DeviceProvider[],
  skills: MentionSkill[],
) {
  const [abierto, setAbierto] = useState(false);
  const [inicio, setInicio] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState("");
  const [resaltado, setResaltado] = useState(0);

  const items = useMentionCandidates(devices, skills, abierto ? query : "");

  const alCambiar = useCallback((valor: string, posicion: number) => {
    setCursor(posicion);
    const det = detectarMencia(valor, posicion);
    if (det) {
      setAbierto(true);
      setInicio(det.inicio);
      setQuery(det.query);
      setResaltado(0);
    } else {
      setAbierto(false);
    }
  }, []);

  const cerrar = useCallback(() => setAbierto(false), []);

  const alPulsarTecla = useCallback(
    (e: { key: string; preventDefault: () => void }): boolean => {
      if (!abierto || items.length === 0) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setResaltado((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setResaltado((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        setAbierto(false);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAbierto(false);
        return true;
      }
      return false;
    },
    [abierto, items.length],
  );

  const itemResaltado = items[resaltado] ?? null;

  return {
    abierto,
    items,
    resaltado,
    inicio,
    cursor,
    itemResaltado,
    alCambiar,
    alPulsarTecla,
    cerrar,
  };
}

export function useClickOutside(
  abierto: boolean,
  onClose: () => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!abierto) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [abierto, onClose, ref]);
}

export default MentionList;
