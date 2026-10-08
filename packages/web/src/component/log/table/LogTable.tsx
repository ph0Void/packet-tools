"use client";

import React from "react";
import type { LogEntry } from "@/service/LogService";
import LogItems from "./LogItems";

interface LogTableProps {
    logs: LogEntry[];
    onPageChange: (page: number) => void;
    paginationData: {
        currentPage: number;
        totalPages: number;
        totalItems: number;
        limit: number;
    };
    canDelete?: boolean;
    onDelete?: (id: string) => void;
}

export default function LogTable({ logs, onPageChange, paginationData, canDelete, onDelete }: LogTableProps) {
    const { currentPage, totalPages, totalItems } = paginationData;

    return (
        <div className="space-y-4 w-full">
            <div className="overflow-x-auto border border-border rounded-lg shadow-sm bg-card custom-scrollbar">

                <table className="w-full min-w-[720px] text-left border-collapse">
                    <thead>
                        <tr className="border-b border-border bg-muted/50 text-muted-foreground uppercase text-xs font-semibold tracking-wider">
                            <th className="py-3.5 px-4 md:px-6">Fecha</th>
                            <th className="py-3.5 px-4 md:px-6">Nivel</th>
                            <th className="py-3.5 px-4 md:px-6">Contenido</th>
                            <th className="py-3.5 px-4 md:px-6">Actor</th>
                            {canDelete && (
                                <th className="py-3.5 px-4 md:px-6 text-right">Acciones</th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {logs.length > 0 ? (
                            logs.map((log) => (
                                <LogItems
                                    key={log.id}
                                    log={log}
                                    canDelete={canDelete}
                                    onDelete={onDelete}
                                />
                            ))
                        ) : (
                            <tr>
                                <td
                                    colSpan={canDelete ? 5 : 4}
                                    className="py-8 text-center text-sm text-muted-foreground bg-card"
                                >
                                    No se encontraron logs disponibles.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex items-center justify-between pt-2 px-1">
                <p className="text-xs text-muted-foreground">
                    Mostrando <span className="font-medium">{logs.length}</span> de{" "}
                    <span className="font-medium">{totalItems}</span> logs
                </p>

                <div className="flex space-x-2">
                    <button
                        onClick={() => onPageChange(currentPage - 1)}
                        disabled={currentPage <= 1}
                        className="px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-card text-foreground transition-all hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                    >
                        Previous
                    </button>

                    <span className="inline-flex items-center justify-center px-3 text-xs text-muted-foreground">
                        Pág. {currentPage} de {totalPages}
                    </span>

                    <button
                        onClick={() => onPageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages}
                        className="px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-card text-foreground transition-all hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}
