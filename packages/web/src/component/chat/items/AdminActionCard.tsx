"use client";

import { AlertTriangle, Check, Settings2 } from "lucide-react";
import type { AdminActionEvent } from "@/hooks/useCiscoChat";
import { cn } from "@/lib/utils";

export function AdminActionCard({
  actions,
  className,
}: {
  actions: AdminActionEvent[];
  className?: string;
}) {
  if (actions.length === 0) return null;

  return (
    <div className={cn("flex w-full max-w-2xl flex-col", className)}>
      {actions.map((action, index) => {
        const ok = action.result === "ok";
        return (
          <div
            key={`${action.action}-${action.target}-${index}`}
            className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 py-[5px]"
          >
            <span
              className="absolute top-0 bottom-0 left-[10.5px] w-px bg-border"
              aria-hidden="true"
            />
            <span className="relative z-[1] grid h-[22px] w-[22px] place-items-center">
              <i
                className={cn(
                  "grid h-[15px] w-[15px] place-items-center rounded-full border bg-card",
                  ok
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-destructive/40 bg-destructive/10 text-destructive",
                )}
              >
                {ok ? (
                  <Check className="size-[9px]" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-[9px]" aria-hidden="true" />
                )}
              </i>
            </span>
            <div className="flex min-h-[22px] min-w-0 items-center gap-2">
              <Settings2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-[12.5px] font-medium text-foreground">
                {action.action}
              </span>
              {action.target && (
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                  → {action.target}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default AdminActionCard;
