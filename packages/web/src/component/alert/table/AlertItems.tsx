"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/utils/FormatDate";
import { Check, Clock, Database, Edit2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { toggleAlertResolvedAction } from "@/action/AlertAction";
import { severityBadgeClass, type AlertRow } from "../types";

interface AlertItemsProps {
    alert: AlertRow;
    canManage: boolean;
    isDeleting: boolean;
    onEdit: (alert: AlertRow) => void;
    onDelete: (id: string) => void;
}

export default function AlertItems({ alert, canManage, isDeleting, onEdit, onDelete }: AlertItemsProps) {
    const router = useRouter();
    const [isToggling, setIsToggling] = useState(false);

    const handleResolve = async () => {
        setIsToggling(true);
        try {
            const res = await toggleAlertResolvedAction(alert.id, !alert.resolved);
            if (res.success) {
                toast.success(
                    alert.resolved
                        ? "Alerta marcada como activa."
                        : "Incidencia marcada como resuelta.",
                );
                router.refresh();
            } else {
                toast.error(res.message || "No se pudo actualizar la alerta.");
            }
        } catch {
            toast.error("Error de comunicación.");
        } finally {
            setIsToggling(false);
        }
    };

    return (
        <tr className={`hover:bg-muted/40 transition-colors bg-card ${alert.resolved ? "opacity-60" : ""}`}>
            <td className="py-4 px-6 text-sm whitespace-nowrap">
                <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${severityBadgeClass(alert.severity)}`}>
                    {alert.severity}
                </span>
            </td>

            <td className="py-4 px-6 text-sm max-w-xs">
                <div className="space-y-0.5">
                    <p className="font-semibold text-foreground">{alert.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground/80 pt-0.5">
                        <Clock className="w-3 h-3" />
                        {formatDate(alert.createdAt)}
                    </span>
                </div>
            </td>

            <td className="py-4 px-6 text-sm text-muted-foreground whitespace-nowrap">
                <span className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-muted-foreground" />
                    {alert.topology?.name || "Desconocida"}
                </span>
            </td>

            <td className="py-4 px-6 text-sm text-muted-foreground whitespace-nowrap">
                {alert.user?.username || "Automático (PT)"}
            </td>

            <td className="py-4 px-6 text-sm whitespace-nowrap">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${alert.resolved
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400"
                    }`}>
                    {alert.resolved ? "RESUELTA" : "ACTIVA"}
                </span>
            </td>

            <td className="py-4 px-6 text-sm whitespace-nowrap text-right">
                {canManage ? (
                    <div className="flex justify-end gap-1.5">
                        <button
                            onClick={handleResolve}
                            disabled={isToggling}
                            className="p-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                            title={alert.resolved ? "Reabrir Incidencia" : "Resolver Incidencia"}
                        >
                            {isToggling ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : alert.resolved ? (
                                <RotateCcw className="w-3.5 h-3.5" />
                            ) : (
                                <Check className="w-3.5 h-3.5" />
                            )}
                        </button>

                        <button
                            onClick={() => onEdit(alert)}
                            className="p-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-sky-500 hover:border-sky-500/30 transition-all cursor-pointer"
                            title="Auditar Gravedad"
                        >
                            <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                            onClick={() => onDelete(alert.id)}
                            disabled={isDeleting}
                            className="p-1.5 rounded-lg border border-border bg-card text-muted-foreground hover:text-rose-500 hover:border-rose-500/30 transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                            title="Eliminar Registro"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ) : (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                        Solo lectura
                    </span>
                )}
            </td>
        </tr>
    );
}
