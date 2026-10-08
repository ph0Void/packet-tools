import { formatDate } from "@/utils/FormatDate";
import { ShieldAlert, CheckCircle2, Clock } from "lucide-react";
import { SEVERITY_BADGE, worstTone } from "./severity";

export interface RecentAlertItem {
  id: string;
  title: string;
  description: string;
  severity: string;
  resolved: boolean;
  createdAt: string | Date;
}

interface RecentAlertsFeedProps {
  alerts: RecentAlertItem[];
}

export default function RecentAlertsFeed({ alerts }: RecentAlertsFeedProps) {
  const unresolved = alerts.filter((a) => !a.resolved);

  const pipe =
    unresolved.length === 0
      ? "ok"
      : worstTone(unresolved.map((a) => a.severity));

  return (
    <section
      className="pipe panel p-5"
      data-pipe={pipe}
      style={{ "--pipe-delay": "180ms" } as React.CSSProperties}
    >
      <header className="mb-4 flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="font-heading text-sm font-semibold text-foreground">
          Alertas recientes
        </h3>
        {unresolved.length > 0 && (
          <span className="eyebrow ml-auto text-critical">
            {unresolved.length} sin resolver
          </span>
        )}
      </header>

      {alerts.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Ninguna alerta registrada. Los eventos de las topologías aparecerán
          aquí.
        </p>
      ) : (
        <ul className="space-y-1">
          {alerts.map((alert) => {
            const severityKey = alert.severity?.toUpperCase() ?? "";
            const badgeClass =
              SEVERITY_BADGE[severityKey] ?? SEVERITY_BADGE.LOW;

            return (
              <li
                key={alert.id}
                className="flex items-start gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-150 hover:bg-muted/60"
              >
                <span
                  className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold uppercase tracking-wider ${badgeClass} ${alert.resolved ? "opacity-50" : ""}`}
                >
                  {severityKey || "N/A"}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[0.8125rem] font-medium text-foreground ${alert.resolved ? "line-through decoration-muted-foreground/50" : ""}`}
                  >
                    {alert.title}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {alert.description}
                  </p>
                  <span className="mt-1 flex items-center gap-1 text-[0.6875rem] text-muted-foreground/80">
                    <Clock className="size-3" />
                    {formatDate(alert.createdAt)}
                  </span>
                </div>

                {alert.resolved && (
                  <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full border border-success/25 bg-success/12 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-success">
                    <CheckCircle2 className="size-3" />
                    Resuelta
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
