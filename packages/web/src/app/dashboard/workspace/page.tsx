import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import { getTopologies } from "@/service/TopologyService";
import WorkspaceContainer from "@/component/workspace/WorkspaceContainer";
import WorkspaceIndexClient from "@/component/workspace/WorkspaceIndexClient";
import { parseTopologyJson } from "@/component/workspace/topology-json";

export const metadata = {
  title: "Packet Tools - Workspace",
  description: "Workspace de topologías de red",
};

export default async function WorkspacePage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  const canEdit = user.role === "STAFF" || user.role === "ADMIN";
  const result = await getTopologies();
  const topologies = result.success && result.data ? result.data : [];

  if (topologies.length === 0) {
    return <WorkspaceIndexClient canEdit={canEdit} />;
  }

  const latest = [...topologies].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];

  const { devices, links } = parseTopologyJson(latest.topologyJson);

  return (
    <WorkspaceContainer
      topologyId={latest.id}
      initialName={latest.name}
      initialDescription={latest.description ?? ""}
      initialDevices={devices}
      initialLinks={links}
      canEdit={canEdit}
    />
  );
}
