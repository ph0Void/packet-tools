"use client";

import { useState } from "react";
import { BookMarked, Check, ChevronDown } from "lucide-react";
import type { RagRetrievedEvent } from "@/hooks/useCiscoChat";
import { cn } from "@/lib/utils";

export function RagSourcesCard({
  rag,
  className,
}: {
  rag: RagRetrievedEvent | null;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  if (!rag || rag.sources.length === 0) return null;

  return (
    <div className={cn("relative grid w-full max-w-2xl grid-cols-[22px_minmax(0,1fr)] gap-x-3 py-[5px]", className)}>
      <span className="absolute top-0 bottom-0 left-[10.5px] w-px bg-border" aria-hidden="true" />
      <span className="relative z-[1] grid h-[22px] w-[22px] place-items-center">
        <i className="grid h-[15px] w-[15px] place-items-center rounded-full border border-success/40 bg-success/10 text-success">
          <Check className="size-[9px]" aria-hidden="true" />
        </i>
      </span>
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="flex min-h-[22px] w-full min-w-0 cursor-pointer items-center gap-2 text-left"
          aria-expanded={abierto}
        >
          <BookMarked className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-[12.5px] font-medium text-foreground">
            Fuentes consultadas
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {rag.sources.length} {rag.sources.length === 1 ? "fuente" : "fuentes"}
            {rag.chunksUsed > 0
              ? ` · ${rag.chunksUsed} ${rag.chunksUsed === 1 ? "extracto" : "extractos"}`
              : ""}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
              abierto && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>

        {abierto && (
          <ul className="space-y-1 pt-1 pb-2">
            {rag.sources.map((source, index) => (
              <li key={`${source}-${index}`} className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
                <span className="w-6 shrink-0 text-right font-mono text-[10.5px] text-muted-foreground/60">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{source}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RagSourcesCard;
