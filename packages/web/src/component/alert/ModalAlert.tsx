"use client";

import React, { startTransition, useActionState, useEffect } from "react";
import { ShieldAlert, X, RefreshCw, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { FormAlertState, createAlertAction, updateAlertAction } from "@/action/AlertAction";
import type { AlertRow } from "./types";

interface ModalAlertProps {
    isOpen: boolean;
    onClose: () => void;
    mode: "create" | "edit";
    alertToEdit: AlertRow | null;
    topologies: { id: string; name: string }[];
}

const SEVERITY_OPTIONS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const initialState: FormAlertState = {
    success: false,
    message: "",
};

export default function ModalAlert({ isOpen, onClose, mode, alertToEdit, topologies }: ModalAlertProps) {
    const [createState, createFormAction, isCreatePending] = useActionState(createAlertAction, initialState);
    const [updateState, updateFormAction, isUpdatePending] = useActionState(updateAlertAction, initialState);

    const isPending = isCreatePending || isUpdatePending;
    const currentState = mode === "create" ? createState : updateState;

    const selectedSeverity =
        mode === "edit" && alertToEdit
            ? String(alertToEdit.severity || "").toUpperCase() || "MEDIUM"
            : "MEDIUM";

    useEffect(() => {
        if (!currentState || !currentState.message) return;

        if (currentState.success) {
            toast.success(currentState.message);
            onClose();
        } else {
            toast.error(currentState.message);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentState]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        startTransition(() => {
            if (mode === "create") {
                createFormAction(formData);
            } else if (mode === "edit" && alertToEdit) {
                formData.append("id", alertToEdit.id);
                updateFormAction(formData);
            }
        });
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-card border border-border rounded-2xl p-6 shadow-2xl relative text-foreground">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                    aria-label="Cerrar modal"
                >
                    <X className="w-5 h-5" />
                </button>

                <h3 className="text-lg font-bold flex items-center gap-2 mb-4">
                    <ShieldAlert className="text-rose-500 w-5 h-5" />
                    {mode === "create" ? "Reportar Incidencia de Red" : "Auditar Gravedad de Alerta"}
                </h3>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {mode === "edit" && alertToEdit && (
                        <div className="text-xs space-y-1 p-3 bg-muted border border-border rounded-xl text-muted-foreground">
                            <p><strong>Incidencia:</strong> {alertToEdit.title}</p>
                            <p><strong>Descripción original:</strong> {alertToEdit.description}</p>
                            <input type="hidden" name="title" value={alertToEdit.title} />
                            <input type="hidden" name="description" value={alertToEdit.description} />
                        </div>
                    )}

                    {mode === "create" && (
                        <>
                            <div>
                                <label htmlFor="alert-title" className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                                    Título de la Alerta
                                </label>
                                <input
                                    id="alert-title"
                                    type="text"
                                    name="title"
                                    placeholder="Ej: Falla de enlace Switch0 a PC1"
                                    className="w-full px-3 py-2 bg-muted border border-border rounded-xl text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    required
                                />
                            </div>

                            <div>
                                <label htmlFor="alert-description" className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                                    Descripción del Fallo
                                </label>
                                <textarea
                                    id="alert-description"
                                    name="description"
                                    rows={3}
                                    placeholder="Detalla la anomalía o comportamiento del software/hardware..."
                                    className="w-full px-3 py-2 bg-muted border border-border rounded-xl text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500"
                                    required
                                />
                            </div>
                        </>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="alert-severity" className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                                Nivel de Gravedad
                            </label>
                            <select
                                id="alert-severity"
                                name="severity"
                                defaultValue={
                                    SEVERITY_OPTIONS.includes(selectedSeverity)
                                        ? selectedSeverity
                                        : "MEDIUM"
                                }
                                className="w-full px-3 py-2 bg-muted border border-border rounded-xl text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                            >
                                {SEVERITY_OPTIONS.includes(selectedSeverity) ? null : (
                                    <option value={selectedSeverity}>{selectedSeverity}</option>
                                )}
                                {SEVERITY_OPTIONS.map((severity) => (
                                    <option key={severity} value={severity}>
                                        {severity}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label htmlFor="alert-topology" className="block text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                                Lienzo de Topología
                            </label>
                            {mode === "edit" && alertToEdit ? (
                                <>
                                    <input type="hidden" name="topology" value={alertToEdit.topologyId ?? ""} />
                                    <input
                                        type="text"
                                        disabled
                                        value={alertToEdit.topology?.name || "Asignada"}
                                        aria-label="Topología asignada"
                                        className="w-full px-3 py-2 bg-muted/60 border border-border rounded-xl text-xs text-muted-foreground opacity-70"
                                    />
                                </>
                            ) : (
                                <select
                                    id="alert-topology"
                                    name="topology"
                                    required
                                    className="w-full px-3 py-2 bg-muted border border-border rounded-xl text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                                >
                                    {topologies.length === 0 && (
                                        <option value="">Sin topologías disponibles</option>
                                    )}
                                    {topologies.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isPending}
                            className="px-4 py-2 text-xs font-semibold rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isPending}
                            className="px-4 py-2 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-xl transition-all flex items-center gap-1.5 dark:bg-sky-600 dark:hover:bg-sky-500 dark:text-white cursor-pointer disabled:opacity-60 disabled:pointer-events-none"
                        >
                            {isPending ? (
                                <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    Procesando...
                                </>
                            ) : mode === "create" ? (
                                <>
                                    <Plus className="w-3.5 h-3.5" />
                                    Reportar Alerta
                                </>
                            ) : (
                                <>
                                    <Save className="w-3.5 h-3.5" />
                                    Guardar Cambios
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
