import type { ReactNode } from "react";
import {
  MonitorSmartphone,
  ShieldAlert,
  CalendarClock,
  Users,
} from "lucide-react";
import { getSessionUser } from "@/action/SecureAction";
import { getAlerts } from "@/service/AlertService";
import { getDevices } from "@/service/DeviceProviderService";
import { getJobs } from "@/service/CronJobService";
import { getAllUsers } from "@/service/UserService";
import { getTopologies } from "@/service/TopologyService";
import type { ApiResponse } from "@/service/client/ApiClient";
import StatsCards, { type StatCardData } from "@/component/home/StatsCards";
import QuickAccess from "@/component/home/QuickAccess";
import RecentAlertsFeed from "@/component/home/RecentAlertsFeed";
import TopologyPreviewCard from "@/component/home/TopologyPreviewCard";
import Chart from "@/component/home/dashboard/Chart";
import { severityTone } from "@/component/home/severity";

export const metadata = {
  title: "Packet Tools - Panel de Monitoreo General",
  description: "Métricas del sistema y monitoreo de red en tiempo real",
};

async function fetchData<T>(
  request: () => Promise<ApiResponse<T>>,
): Promise<T | null> {
  try {
    const response = await request();
    return response.success ? response.data : null;
  } catch {
    return null;
  }
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2">
      <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-primary" />
      <span className="eyebrow">{children}</span>
    </h2>
  );
}

export default async function HomePage() {
  const [user, alerts, devices, jobs, users, topologies] = await Promise.all([
    getSessionUser().catch(() => null),
    fetchData(getAlerts),
    fetchData(getDevices),
    fetchData(getJobs),
    fetchData(getAllUsers),
    fetchData(getTopologies),
  ]);

  const safeAlerts = alerts ?? [];
  const safeDevices = devices ?? [];
  const safeJobs = jobs ?? [];
  const safeUsers = users ?? [];

  const onlineDevices = safeDevices.filter(
    (device) => device.status?.toUpperCase() === "ONLINE",
  );
  const unresolved = safeAlerts.filter((alert) => !alert.resolved);
  const activeAlerts = unresolved;
  const activeJobs = safeJobs.filter((job) => job.isActive);

  const recentAlerts = [...safeAlerts]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 5);

  const SEVERITY_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
  const worstSeverity = unresolved.reduce<keyof typeof SEVERITY_ORDER>(
    (worst, alert) => {
      const key = (alert.severity?.toUpperCase() ??
        "LOW") as keyof typeof SEVERITY_ORDER;
      return SEVERITY_ORDER[key] > SEVERITY_ORDER[worst] ? key : worst;
    },
    "LOW",
  );

  const devicesTone =
    safeDevices.length === 0
      ? "idle"
      : onlineDevices.length < safeDevices.length
        ? "warning"
        : "success";

  const stats: StatCardData[] = [
    {
      label: "Equipos online",
      value: onlineDevices.length,
      hint: `de ${safeDevices.length} registrados`,
      icon: MonitorSmartphone,
      tone: devicesTone,
    },
    {
      label: "Alertas activas",
      value: activeAlerts.length,
      hint:
        activeAlerts.length === 0
          ? `sin incidencias abiertas · ${safeAlerts.length} en total`
          : `peor severidad: ${worstSeverity.toLowerCase()}`,
      icon: ShieldAlert,
      tone: activeAlerts.length === 0 ? "success" : severityTone(worstSeverity),
    },
    {
      label: "Tareas programadas",
      value: activeJobs.length,
      hint: `${safeJobs.length} configuradas`,
      icon: CalendarClock,
      tone: activeJobs.length === 0 ? "idle" : "success",
    },
    {
      label: "Usuarios registrados",
      value: safeUsers.length,
      hint: user ? `Sesión: ${user.username}` : undefined,
      icon: Users,
      tone: "info",
    },
  ];

  const severityBars = (
    [
      { label: "Crítica", value: "CRITICAL", barClassName: "bg-critical" },
      { label: "Alta", value: "HIGH", barClassName: "bg-high" },
      { label: "Media", value: "MEDIUM", barClassName: "bg-medium" },
      { label: "Baja", value: "LOW", barClassName: "bg-low" },
    ] as const
  ).map((item) => ({
    ...item,
    count: safeAlerts.filter(
      (alert) => alert.severity?.toUpperCase() === item.value,
    ).length,
  }));

  return (
    <div className="mx-auto space-y-8">
      <header>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground md:text-[1.75rem] md:leading-tight">
          {user
            ? `Bienvenido ${user.username} 👋 `
            : `Monitoreo general de red y sistema.`}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Resumen operativo del sistema.
        </p>
      </header>

      <section>
        <SectionLabel>Estadísticas rápidas</SectionLabel>
        <StatsCards stats={stats} />
      </section>

      <section>
        <SectionLabel>Accesos directos</SectionLabel>
        <QuickAccess />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="panel p-5">
            <header className="mb-5 flex items-center gap-2">
              <h3 className="font-heading text-sm font-semibold text-foreground">
                Alertas por severidad
              </h3>
              <span className="eyebrow ml-auto">
                {safeAlerts.length} en total
              </span>
            </header>
            <Chart
              bars={severityBars.map((bar) => ({
                label: bar.label,
                value: bar.count,
                barClassName: bar.barClassName,
              }))}
              emptyMessage="Ninguna alerta registrada todavía. Cuando una topología reporte un evento aparecerá aquí."
            />
          </section>

          <RecentAlertsFeed alerts={recentAlerts} />
        </div>

        <TopologyPreviewCard
          topology={
            topologies && topologies.length > 0
              ? {
                  id: topologies[0].id,
                  name: topologies[0].name,
                  description: topologies[0].description,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
