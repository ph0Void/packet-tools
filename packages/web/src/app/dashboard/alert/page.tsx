import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import { getAlerts } from "@/service/AlertService";
import { getTopologies } from "@/service/TopologyService";
import TableAlertWrapper from "@/component/alert/TableAlertWrapper";

export const metadata = {
  title: "Packet Tools - Gestión de Alertas",
  description: "Registro, auditoría y resolución de incidencias de red",
};

export default async function AlertPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  const [alertsResult, topologiesResult] = await Promise.allSettled([
    getAlerts(),
    getTopologies(),
  ]);

  const alerts =
    alertsResult.status === "fulfilled" &&
    alertsResult.value.success &&
    alertsResult.value.data
      ? alertsResult.value.data
      : [];

  const topologies =
    topologiesResult.status === "fulfilled" &&
    topologiesResult.value.success &&
    topologiesResult.value.data
      ? topologiesResult.value.data.map((topology) => ({
          id: topology.id,
          name: topology.name,
        }))
      : [];

  return (
    <div className="space-y-6 text-foreground p-1">
      <TableAlertWrapper
        initialAlerts={alerts}
        topologies={topologies}
        userRole={user.role}
      />
    </div>
  );
}
