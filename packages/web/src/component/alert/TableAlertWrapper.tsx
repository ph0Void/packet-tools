"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { deleteAlertAction } from "@/action/AlertAction";
import AlertTable from "./table/AlertTable";
import ModalAlert from "./ModalAlert";
import type { AlertRow } from "./types";
import { Button } from "@/components/ui/button";

const SEVERITY_OPTIONS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const PAGE_SIZE = 10;

interface TableAlertWrapperProps {
  initialAlerts: AlertRow[];
  topologies: { id: string; name: string }[];
  userRole: string;
}

export default function TableAlertWrapper({
  initialAlerts,
  topologies,
  userRole,
}: TableAlertWrapperProps) {
  const router = useRouter();

  const [severityFilter, setSeverityFilter] = useState<string>("TODAS");
  const [stateFilter, setStateFilter] = useState<"ALL" | "ACTIVE" | "RESOLVED">(
    "ALL",
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedAlert, setSelectedAlert] = useState<AlertRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canManage = userRole === "ADMIN" || userRole === "STAFF";

  const filteredAlerts = useMemo(() => {
    const term = search.trim().toLowerCase();

    return initialAlerts.filter((alert) => {
      const matchesSeverity =
        severityFilter === "TODAS" ||
        alert.severity?.toUpperCase() === severityFilter;
      const matchesState =
        stateFilter === "ALL" ||
        (stateFilter === "ACTIVE" ? !alert.resolved : alert.resolved);
      const matchesSearch =
        !term ||
        alert.title.toLowerCase().includes(term) ||
        alert.description.toLowerCase().includes(term);

      return matchesSeverity && matchesState && matchesSearch;
    });
  }, [initialAlerts, severityFilter, stateFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pagedAlerts = useMemo(
    () =>
      filteredAlerts.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE,
      ),
    [filteredAlerts, currentPage],
  );

  const handlePageChange = (nextPage: number) => {
    setPage(Math.min(Math.max(1, nextPage), totalPages));
  };

  const handleSeverityChange = (value: string) => {
    setSeverityFilter(value);
    setPage(1);
  };

  const handleStateChange = (value: "ALL" | "ACTIVE" | "RESOLVED") => {
    setStateFilter(value);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleOpenCreate = () => {
    setModalMode("create");
    setSelectedAlert(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (alert: AlertRow) => {
    setModalMode("edit");
    setSelectedAlert(alert);
    setIsModalOpen(true);
  };

  const handleDeleteAlert = async (id: string) => {
    if (!confirm("¿Eliminar de forma permanente esta alerta del sistema?"))
      return;

    setDeletingId(id);
    try {
      const res = await deleteAlertAction(id);
      if (res.success) {
        toast.success(res.message || "Alerta eliminada del sistema.");
        router.refresh();
      } else {
        toast.error(res.message || "No se pudo eliminar la alerta.");
      }
    } catch {
      toast.error("Error al procesar la eliminación.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/40 bg-muted/30 p-4 md:p-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShieldAlert className="h-5 w-5 text-primary" />
            Alertas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestione los reportes de incidencias del sistema
          </p>
        </div>

        {canManage && (
          <Button
            onClick={handleOpenCreate}
            className="gap-2 self-start sm:self-auto shrink-0"
          >
            <AlertTriangle className="w-4 h-4" />
            Reportar Incidencia
          </Button>
        )}
      </div>

      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 p-3 rounded-xl border border-border bg-muted/40">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Buscar por título o descripción..."
            className="w-full pl-9 pr-3 py-2 bg-card border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>

        <select
          value={severityFilter}
          onChange={(e) => handleSeverityChange(e.target.value)}
          aria-label="Filtrar por gravedad"
          className="px-3 py-2 bg-card border border-border rounded-xl text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
        >
          <option value="TODAS">TODAS LAS GRAVEDADES</option>
          {SEVERITY_OPTIONS.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>

        <select
          value={stateFilter}
          onChange={(e) =>
            handleStateChange(e.target.value as "ALL" | "ACTIVE" | "RESOLVED")
          }
          aria-label="Filtrar por estado"
          className="px-3 py-2 bg-card border border-border rounded-xl text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
        >
          <option value="ALL">Todas</option>
          <option value="ACTIVE">Activas</option>
          <option value="RESOLVED">Resueltas</option>
        </select>
      </div>

      <div className="p-6 rounded-xl border border-border bg-card shadow-sm">
        <AlertTable
          alerts={pagedAlerts}
          canManage={canManage}
          deletingId={deletingId}
          onPageChange={handlePageChange}
          onEditAlert={handleOpenEdit}
          onDeleteAlert={handleDeleteAlert}
          paginationData={{
            currentPage,
            totalPages,
            totalItems: filteredAlerts.length,
            limit: PAGE_SIZE,
          }}
        />
      </div>

      <ModalAlert
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mode={modalMode}
        alertToEdit={selectedAlert}
        topologies={topologies}
      />
    </div>
  );
}
