"use client";

import { useState } from "react";
import { Check, ChevronDown, ListTodo, LoaderCircle } from "lucide-react";
import type { PlanTodo } from "@/hooks/useCiscoChat";
import { cn } from "@/lib/utils";

export function PlanTodos({
  todos,
  className,
  defaultOpen = true,
}: {
  todos: PlanTodo[];
  className?: string;
  defaultOpen?: boolean;
}) {
  const [abierto, setAbierto] = useState(defaultOpen);
  if (todos.length === 0) return null;

  const completados = todos.filter((t) => t.status === "completed").length;
  const progreso = Math.round((completados / todos.length) * 100);

  return (
    <div
      className={cn(
        "w-full max-w-2xl overflow-hidden rounded-[10px] border border-border bg-card",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-[7px] text-left"
        aria-expanded={abierto}
      >
        <ListTodo className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.105em] text-muted-foreground">
          Plan
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {completados}/{todos.length}
        </span>
        <span className="h-[3px] w-full max-w-[120px] flex-1 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full rounded-full bg-success transition-[width] duration-500"
            style={{ width: `${progreso}%` }}
          />
        </span>
        <span className="flex-1" />
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            abierto && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {abierto && (
        <ul className="border-t border-border px-0 pb-2">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={cn(
                "flex items-start gap-3 px-4 py-[5px] text-[12.5px]",
                todo.status === "completed" && "text-muted-foreground line-through decoration-border",
                todo.status === "in_progress" && "font-medium text-foreground",
                todo.status === "pending" && "text-muted-foreground",
              )}
            >
              {todo.status === "completed" ? (
                <Check className="mt-[3px] size-3.5 shrink-0 text-success" aria-hidden="true" />
              ) : todo.status === "in_progress" ? (
                <LoaderCircle className="mt-[3px] size-3.5 shrink-0 animate-spin text-warning" aria-hidden="true" />
              ) : (
                <span
                  className="mt-[7px] size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                  aria-hidden="true"
                />
              )}
              <span className="leading-relaxed">{todo.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PlanTodos;
