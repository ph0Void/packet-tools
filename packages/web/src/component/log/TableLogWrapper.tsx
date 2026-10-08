"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import LogTable from "./table/LogTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LogEntry } from "@/service/LogService";
import { clearLogsAction, deleteLogAction } from "@/action/LogAction";
import { Download, Eraser, Info, ListChecks, Search } from "lucide-react";
import { NIVELES_LOG_POR_DEFECTO } from "./levels";

const TODOS = "__todos__";

interface TableLogWrapperProps {
  initialLogs: LogEntry[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    limit: number;
  };
  currentLevel: string;
  isAdmin: boolean;

  levels: string[];
}

function downloadFile(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function TableLogWrapper({
  initialLogs,
  pagination,
  currentLevel,
  isAdmin,
  levels,
}: TableLogWrapperProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchText, setSearchText] = useState("");
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  const nivelesDisponibles =
    levels.length > 0 ? levels : NIVELES_LOG_POR_DEFECTO;

  const filteredLogs = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return initialLogs;
    return initialLogs.filter((log) =>
      `${log.level} ${log.title} ${log.content} ${log.actor?.username ?? ""}`
        .toLowerCase()
        .includes(query),
    );
  }, [initialLogs, searchText]);

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("page", page.toString());
    const query = params.toString();
    router.push(`/dashboard/log${query ? `?${query}` : ""}`);
  };

  const handleLevelChange = (level: string) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.set("page", "1");
    if (level === TODOS) {
      params.delete("level");
    } else {
      params.set("level", level);
    }
    const query = params.toString();
    router.push(`/dashboard/log${query ? `?${query}` : ""}`);
  };

  const handleExportJson = () => {
    downloadFile(
      "logs-export.json",
      "application/json;charset=utf-8",
      JSON.stringify(filteredLogs, null, 2),
    );
  };

  const handleExportCsv = () => {
    const header = ["createdAt", "level", "title", "content", "actor", "role"]
      .map(csvCell)
      .join(",");
    const rows = filteredLogs.map((log) =>
      [
        log.createdAt,
        log.level,
        log.title ?? "",
        log.content,
        log.actor?.username ?? "Sistema",
        log.actor?.role ?? "",
      ]
        .map((cell) => csvCell(String(cell)))
        .join(","),
    );
    downloadFile(
      "logs-export.csv",
      "text/csv;charset=utf-8",
      `\uFEFF${[header, ...rows].join("\n")}`,
    );
  };

  const handleClearLogs = async () => {
    const result = await clearLogsAction();
    if (!result.success) {
      toast.error(result.message || "Error al vaciar el historial.");
      return;
    }
    toast.success(result.message || "Historial vaciado.");
    setIsClearDialogOpen(false);
    router.refresh();
  };

  const handleDeleteLog = async (id: string) => {
    const result = await deleteLogAction(id);
    if (!result.success) {
      toast.error(result.message || "Error al eliminar el log.");
      return;
    }
    toast.success(result.message || "Log eliminado.");
    router.refresh();
  };

  return (
    <div className="w-full space-y-4">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/40 bg-muted/30 p-4 md:p-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ListChecks className="h-5 w-5 text-primary" />
            Registros
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Historial de eventos del sistema y de la traza del agente.
          </p>
        </div>

      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="log-level-filter">Nivel</Label>
            <Select
              value={currentLevel || TODOS}
              onValueChange={handleLevelChange}
            >
              <SelectTrigger id="log-level-filter" className="w-full sm:w-48">
                <SelectValue placeholder="Filtrar por nivel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>TODOS</SelectItem>
                {nivelesDisponibles.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="log-search">Buscar</Label>
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="log-search"
                placeholder="Buscar en la página actual..."
                className="pl-8 sm:w-64"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJson}
            className="gap-2"
          >
            <Download className="h-4 w-4" /> Exportar JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="gap-2"
          >
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
          {isAdmin && (
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              onClick={() => setIsClearDialogOpen(true)}
            >
              <Eraser className="h-4 w-4" /> Vaciar historial
            </Button>
          )}
        </div>
      </div>

      {!isAdmin && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground px-1">
          <Info className="h-3.5 w-3.5 mt-px shrink-0" />
          <span>
            Solo ves tus propios registros. Como administrador, el listado
            incluye los de todos los usuarios y las ejecuciones programadas.
          </span>
        </p>
      )}

      <LogTable
        logs={filteredLogs}
        onPageChange={handlePageChange}
        paginationData={pagination}
        canDelete={isAdmin}
        onDelete={handleDeleteLog}
      />

      <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Vaciar historial de logs</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se eliminarán todos los registros del sistema de forma permanente.
            Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsClearDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleClearLogs}>
              Vaciar todo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
