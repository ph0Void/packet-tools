import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import { getTopologies } from "@/service/TopologyService";
import TableTopologyWrapper from "@/component/topology/TableTopologyWrapper";
import type { TopologyRow } from "@/component/topology/types";

export const metadata = {
  title: "Packet Tools - Topologías",
  description: "Gestión de topologías de red",
};

interface PageProps {
  searchParams: Promise<{ page?: string; limit?: string }>;
}

const DEFAULT_PAGE_SIZE = 10;

export default async function TopologyPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  const params = await searchParams;
  const currentPage = Number(params.page) || 1;
  const currentLimit = Number(params.limit) || DEFAULT_PAGE_SIZE;

  const result = await getTopologies();
  const allTopologies =
    result.success && result.data
      ? result.data.map<TopologyRow>((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          createdAt: t.createdAt,
        }))
      : [];

  const totalItems = allTopologies.length;
  const totalPages = Math.ceil(totalItems / currentLimit) || 1;
  const start = (currentPage - 1) * currentLimit;
  const topologies = allTopologies.slice(start, start + currentLimit);

  return (
    <div className="space-y-4 text-foreground">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Gestión de Topologías
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Información general de las topologías que se generan en la red. (en
          desarrollo)
        </p>
      </div>

      <TableTopologyWrapper
        initialTopologies={topologies}
        pagination={{
          currentPage,
          totalPages,
          totalItems,
          limit: currentLimit,
        }}
        canManage={user.role === "ADMIN" || user.role === "STAFF"}
      />
    </div>
  );
}
