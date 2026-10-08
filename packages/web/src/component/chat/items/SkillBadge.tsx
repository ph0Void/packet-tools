"use client";

import { useEffect, useState } from "react";
import { BookOpen, Check, LoaderCircle } from "lucide-react";
import type { SkillLoadingEvent } from "@/hooks/useCiscoChat";
import { cn } from "@/lib/utils";

export function SkillBadge({
  skill,
  className,
}: {
  skill: SkillLoadingEvent | null;
  className?: string;
}) {

  const [recienCargada, setRecienCargada] = useState<string | null>(null);

  useEffect(() => {
    if (!skill) return;
    const timer = setTimeout(() => setRecienCargada(skill.skillName), 0);
    return () => clearTimeout(timer);
  }, [skill]);

  useEffect(() => {
    if (!recienCargada) return;
    const timer = setTimeout(() => setRecienCargada(null), 3000);
    return () => clearTimeout(timer);
  }, [recienCargada]);

  if (skill) {
    return (
      <div className={cn("relative grid w-full max-w-2xl grid-cols-[22px_minmax(0,1fr)] gap-x-3 py-[5px]", className)}>
        <span className="absolute top-0 bottom-0 left-[10.5px] w-px bg-border" aria-hidden="true" />
        <span className="relative z-[1] grid h-[22px] w-[22px] place-items-center">
          <i className="grid h-[15px] w-[15px] place-items-center rounded-full border border-primary/40 bg-card text-primary">
            <LoaderCircle className="size-[9px] animate-spin" aria-hidden="true" />
          </i>
        </span>
        <div className="flex min-h-[22px] min-w-0 items-center gap-2">
          <BookOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-[12.5px] font-medium text-foreground">Skill en uso</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {skill.skillName}
          </span>
        </div>
      </div>
    );
  }

  if (recienCargada) {
    return (
      <div className={cn("relative grid w-full max-w-2xl grid-cols-[22px_minmax(0,1fr)] gap-x-3 py-[5px]", className)}>
        <span className="absolute top-0 bottom-0 left-[10.5px] w-px bg-border" aria-hidden="true" />
        <span className="relative z-[1] grid h-[22px] w-[22px] place-items-center">
          <i className="grid h-[15px] w-[15px] place-items-center rounded-full border border-success/40 bg-success/10 text-success">
            <Check className="size-[9px]" aria-hidden="true" />
          </i>
        </span>
        <div className="flex min-h-[22px] min-w-0 items-center gap-2">
          <span className="text-[12.5px] font-medium text-foreground">Skill cargada</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {recienCargada}
          </span>
        </div>
      </div>
    );
  }

  return null;
}

export default SkillBadge;
