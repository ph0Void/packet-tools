import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import { getTopologyByIdAction } from "@/action/TopologyAction";
import WorkspaceContainer from "@/component/workspace/WorkspaceContainer";
import { parseTopologyJson } from "@/component/workspace/topology-json";
import { notFound } from "next/navigation";

export const metadata = {
  title: "Packet Tools - Workspace",
  description: "Editor de topología de red",
};

interface WorkspacePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function WorkspacePageId({ params }: WorkspacePageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  const canEdit = user.role === "STAFF" || user.role === "ADMIN";

  const { id } = await params;
  const result = await getTopologyByIdAction(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const { devices, links } = parseTopologyJson(result.data.topologyJson);

  return (
    <WorkspaceContainer
      topologyId={id}
      initialName={result.data.name}
      initialDescription={result.data.description ?? ""}
      initialDevices={devices}
      initialLinks={links}
      canEdit={canEdit}
    />
  );
}
