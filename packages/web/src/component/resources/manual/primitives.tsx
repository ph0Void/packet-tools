"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Info,
  Lightbulb,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground">{children}</h3>;
}

export function Paragraph({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-primary">
      {children}
    </code>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-primary">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function Steps({
  items,
}: {
  items: { title: string; description: React.ReactNode }[];
}) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={`${index}-${item.title}`} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-semibold text-primary">
            {index + 1}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <div className="text-sm leading-relaxed text-muted-foreground">
              {item.description}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function FieldTable({
  rows,
}: {
  rows: { label: string; help: React.ReactNode; example?: string }[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
          <tr>
            <th className="p-3">Campo</th>
            <th className="p-3">Descripción</th>
            <th className="p-3">Ejemplo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="p-3 align-top font-medium whitespace-nowrap text-foreground">
                {row.label}
              </td>
              <td className="p-3 align-top text-muted-foreground">
                {row.help}
              </td>
              <td className="p-3 align-top text-muted-foreground">
                {row.example ? <InlineCode>{row.example}</InlineCode> : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="p-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="p-3 align-top text-muted-foreground"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CALLOUT_STYLES = {
  info: {
    container: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    icon: Info,
  },
  tip: {
    container: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
    icon: Lightbulb,
  },
  warning: {
    container: "border-amber-500/30 bg-amber-500/10 text-amber-500",
    icon: AlertTriangle,
  },
  danger: {
    container: "border-red-500/30 bg-red-500/10 text-red-500",
    icon: ShieldAlert,
  },
} as const;

export function Callout({
  variant = "info",
  title,
  children,
}: {
  variant?: keyof typeof CALLOUT_STYLES;
  title?: string;
  children: React.ReactNode;
}) {
  const style = CALLOUT_STYLES[variant];
  const Icon = style.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-3 text-sm",
        style.container,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-xs leading-relaxed text-foreground/80">
          {children}
        </div>
      </div>
    </div>
  );
}

export function CodeBlock({
  code,
  label,
}: {
  code: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Copiado al portapapeles.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      )}
      <div className="relative overflow-hidden rounded-lg border border-border bg-muted/50">
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label="Copiar al portapapeles"
          className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        <pre className="overflow-x-auto p-4 pr-12 font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
