import type { CSSProperties } from "react";

export type PipeState = "ok" | "warn" | "crit" | "info" | "idle";

export type Tone = "success" | "warning" | "critical" | "info" | "idle";

const TONE: Record<Tone, { pipe: PipeState; tile: string }> = {
  success: { pipe: "ok", tile: "bg-success/12 text-success" },
  warning: { pipe: "warn", tile: "bg-warning/15 text-warning" },
  critical: { pipe: "crit", tile: "bg-critical/12 text-critical" },
  info: { pipe: "info", tile: "bg-primary/10 text-primary" },
  idle: { pipe: "idle", tile: "bg-muted text-muted-foreground" },
};

interface ItemCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ReactNode;
  tone?: Tone;

  delay?: number;
}

export function ItemCard({
  label,
  value,
  hint,
  icon,
  tone = "idle",
  delay = 0,
}: ItemCardProps) {
  const { pipe, tile } = TONE[tone];

  return (
    <div
      className="pipe panel flex items-center gap-3.5 p-4 transition-colors duration-200 hover:border-primary/35"
      data-pipe={pipe}
      style={
        delay ? ({ "--pipe-delay": `${delay}ms` } as CSSProperties) : undefined
      }
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-[1.125rem] ${tile}`}
      >
        {icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="eyebrow truncate">{label}</p>

        <p className="readout mt-1.5 text-[1.75rem] leading-none text-foreground">
          {value}
        </p>
        {hint && (
          <p className="mt-1.5 truncate text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
