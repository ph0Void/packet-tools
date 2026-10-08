"use client";

import type { LogEntry } from "@/service/LogService";
import { formatDate } from "@/utils/FormatDate";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { tonoNivelLog } from "../levels";

interface LogItemsProps {
    log: LogEntry;
    canDelete?: boolean;
    onDelete?: (id: string) => void;
}

export default function LogItems({ log, canDelete, onDelete }: LogItemsProps) {
    const levelStyle = tonoNivelLog(log.level);

    return (
        <tr className="hover:bg-muted/40 transition-colors bg-card">
            <td className="py-4 px-4 md:px-6 text-sm text-muted-foreground whitespace-nowrap">
                {formatDate(log.createdAt)}
            </td>

            <td className="py-4 px-4 md:px-6 whitespace-nowrap">
                <span
                    className={cn(
                        "inline-block rounded-full border px-2 py-0.5 text-xs font-semibold",
                        levelStyle,
                    )}
                >
                    {log.level.toUpperCase()}
                </span>
            </td>

            <td className="py-4 px-4 md:px-6 text-sm text-foreground font-medium max-w-md break-words">
                {log.content}
            </td>

            <td className="py-4 px-4 md:px-6 whitespace-nowrap">
                {log.actor ? (
                    <span className="flex flex-col leading-tight">
                        <span className="text-sm text-foreground">
                            {log.actor.username}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {log.actor.role}
                        </span>
                    </span>
                ) : (
                    <span className="text-xs text-muted-foreground">Sistema</span>
                )}
            </td>

            {canDelete && (
                <td className="py-4 px-4 md:px-6 text-right">
                    <Button
                        size="icon"
                        variant="ghost"
                        title="Eliminar log"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => onDelete?.(log.id)}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </td>
            )}
        </tr>
    );
}
