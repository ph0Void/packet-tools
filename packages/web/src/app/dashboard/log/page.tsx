import { redirect } from "next/navigation";
import TableLogWrapper from "@/component/log/TableLogWrapper";
import { NIVELES_LOG_POR_DEFECTO } from "@/component/log/levels";
import { getSessionUser } from "@/action/SecureAction";
import { getAllLogsAction, getLogLevelsAction } from "@/action/LogAction";

export const metadata = {
  title: "Packet Tools - Gestión de Logs",
  description: "Historial de eventos generados en la red",
};

interface PageProps {
  searchParams: Promise<{ page?: string; limit?: string; level?: string }>;
}

export default async function LogPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  const params = await searchParams;
  const currentPage = Math.max(1, Number(params.page) || 1);
  const currentLimit = Number(params.limit) || 20;
  const currentLevel =
    params.level && params.level !== "TODOS" ? params.level : undefined;

  const [result, niveles] = await Promise.all([
    getAllLogsAction(currentPage, currentLimit, currentLevel),
    getLogLevelsAction(),
  ]);

  const availableLevels =
    niveles.success && niveles.data && niveles.data.length > 0
      ? niveles.data
      : NIVELES_LOG_POR_DEFECTO;

  if (!niveles.success && process.env.NODE_ENV === "development") {
    console.warn(
      "No se pudieron obtener los niveles de log, se usa la lista de respaldo:",
      niveles.message,
    );
  }

  const data = result.success && result.data ? result.data : null;
  const initialLogs = data?.items ?? [];
  const totalItems = data?.total ?? 0;
  const totalPages = Math.ceil(totalItems / currentLimit) || 1;

  return (
    <div className="space-y-4 text-foreground p-4">
      <TableLogWrapper
        initialLogs={initialLogs}
        pagination={{
          currentPage,
          totalPages,
          totalItems,
          limit: currentLimit,
        }}
        currentLevel={params.level ?? "TODOS"}
        isAdmin={user.role === "ADMIN"}
        levels={availableLevels}
      />
    </div>
  );
}
