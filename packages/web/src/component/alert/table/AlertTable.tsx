"use client";

import AlertItems from "./AlertItems";
import type { AlertRow } from "../types";

interface AlertTableProps {
    alerts: AlertRow[];
    canManage: boolean;
    deletingId: string | null;
    onPageChange: (page: number) => void;
    onEditAlert: (alert: AlertRow) => void;
    onDeleteAlert: (id: string) => void;
    paginationData: {
        currentPage: number;
        totalPages: number;
        totalItems: number;
        limit: number;
    };
}

export default function AlertTable({ alerts, canManage, deletingId, onPageChange, onEditAlert, onDeleteAlert, paginationData }: AlertTableProps) {
    const { currentPage, totalPages, totalItems } = paginationData;

    return (
        <div className="space-y-4 w-full">
            <div className="overflow-x-auto border border-border rounded-lg shadow-sm bg-card custom-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-border bg-muted/50 text-muted-foreground uppercase text-[10px] font-semibold tracking-wider">
                            <th className="py-3.5 px-6">Gravedad</th>
                            <th className="py-3.5 px-6">Incidencia</th>
                            <th className="py-3.5 px-6">Topología</th>
                            <th className="py-3.5 px-6">Reportado Por</th>
                            <th className="py-3.5 px-6">Estado</th>
                            <th className="py-3.5 px-6 text-right">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {alerts.length > 0 ? (
                            alerts.map((alert) => (
                                <AlertItems
                                    key={alert.id}
                                    alert={alert}
                                    canManage={canManage}
                                    isDeleting={deletingId === alert.id}
                                    onEdit={onEditAlert}
                                    onDelete={onDeleteAlert}
                                />
                            ))
                        ) : (
                            <tr>
                                <td colSpan={6} className="py-8 text-center text-sm text-muted-foreground bg-card">
                                    No se encontraron incidencias bajo este filtro.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between pt-2 px-1">
                <p className="text-xs text-muted-foreground">
                    Mostrando <span className="font-medium text-foreground">{alerts.length}</span> de <span className="font-medium text-foreground">{totalItems}</span> registros
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
