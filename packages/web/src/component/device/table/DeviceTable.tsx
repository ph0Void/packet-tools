"use client";

import DeviceItems from "./DeviceItems";
import type { DeviceProvider } from "@/service/DeviceProviderService";

interface DeviceTableProps {
  devices: DeviceProvider[];
  canManage: boolean;
  testingId?: string | null;
  onPageChange: (page: number) => void;
  paginationData: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    limit: number;
  };
  onEdit: (device: DeviceProvider) => void;
  onDelete: (device: DeviceProvider) => void;
  onTest: (device: DeviceProvider) => void;

  onKeep: (device: DeviceProvider) => void;
}

export default function DeviceTable({
  devices,
  canManage,
  testingId,
  onPageChange,
  paginationData,
  onEdit,
  onDelete,
  onTest,
  onKeep,
}: DeviceTableProps) {
  const { currentPage, totalPages, totalItems } = paginationData;

  return (
    <div className="space-y-4 w-full">
      <div className="overflow-x-auto border border-border rounded-lg shadow-sm bg-card custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-muted-foreground uppercase text-xs font-semibold tracking-wider">
              <th className="py-3 px-6">Dispositivo</th>
              <th className="py-3 px-6">Tipo</th>
              <th className="py-3 px-6">Protocolo</th>
              <th className="py-3 px-6">Endpoint</th>
              <th className="py-3 px-6">Estado</th>
              <th className="py-3 px-6 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {devices.length > 0 ? (
              devices.map((device) => (
                <DeviceItems
                  key={device.id}
                  device={device}
                  canManage={canManage}
                  testing={testingId === device.id}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onTest={onTest}
                  onKeep={onKeep}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground bg-card"
                >
                  No se encontraron dispositivos disponibles.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-2 px-1">
        <p className="text-xs text-muted-foreground">
          Mostrando <span className="font-medium">{devices.length}</span> de{" "}
          <span className="font-medium">{totalItems}</span> dispositivos
        </p>

        <div className="flex space-x-2">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-card text-foreground transition-all hover:bg-muted disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            Anterior
          </button>

          <span className="inline-flex items-center justify-center px-3 text-xs text-muted-foreground">
            Pág. {currentPage} de {totalPages}
          </span>

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-card text-foreground transition-all hover:bg-muted disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
