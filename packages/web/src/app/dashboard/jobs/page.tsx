import { redirect } from "next/navigation";
import CronJobManager from "@/component/jobs/CronJobManager";
import type { CronJobRow } from "@/component/jobs/CronJobManager";
import { getSessionUser } from "@/action/SecureAction";
import { getJobs } from "@/service/CronJobService";
import { getTopologies } from "@/service/TopologyService";
import { getDevices } from "@/service/DeviceProviderService";

export const metadata = {
  title: "Packet Tools - Automatización",
  description:
    "Gestión y programación de automatizaciones de red con IA o scripts manuales.",
};

export default async function PageCronJobs() {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  const [jobsRes, topologiesRes, devicesRes] = await Promise.all([
    getJobs(),
    getTopologies(),
    getDevices(),
  ]);

  const initialJobs: CronJobRow[] = (jobsRes.data ?? []) as CronJobRow[];
  const topologies = (topologiesRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
  }));

  const devices = (devicesRes.data ?? []).map((d) => ({
    id: d.id,
    name: `${d.name} (${d.typeDevice})`,
    protocol: d.protocol,
    typeDevice: d.typeDevice,
  }));

  return (
    <div className="space-y-6 text-foreground p-4">
      <CronJobManager
        initialJobs={initialJobs}
        topologies={topologies}
        devices={devices}
        canManage={user.role === "STAFF" || user.role === "ADMIN"}
      />
    </div>
  );
}
