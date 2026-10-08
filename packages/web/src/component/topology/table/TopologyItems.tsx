"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import { Edit2, Trash2 } from "lucide-react";
import { formatDate } from "@/utils/FormatDate";
import type { TopologyRow } from "../types";

interface TopologyItemsProps {
  topology: TopologyRow;
  canManage: boolean;
  onEdit: (topology: TopologyRow) => void;
  onDelete: (topology: TopologyRow) => void;
}

export default function TopologyItems({
  topology,
  canManage,
  onEdit,
  onDelete,
}: TopologyItemsProps) {
  return (
    <tr className="hover:bg-muted/40 transition-colors bg-card">
      <td className="py-4 px-6 text-sm text-foreground font-medium whitespace-nowrap">
        {topology.name}
      </td>

      <td className="py-4 px-6 text-sm whitespace-nowrap text-muted-foreground max-w-md break-words">
        {topology.description || "Sin descripción"}
      </td>

      <td className="py-4 px-6 text-sm text-muted-foreground whitespace-nowrap">
        {formatDate(topology.createdAt)}
      </td>

      <td className="py-4 px-6 text-sm text-right whitespace-nowrap">
        <div className="flex justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs cursor-pointer"
            asChild
          >
            <Link href={`/dashboard/workspace/${topology.id}`}>
              <Play className="h-3 w-3 fill-current" />
              Cargar
            </Link>
          </Button>

          {canManage && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                className="cursor-pointer"
                aria-label={`Editar ${topology.name}`}
                title="Editar topología"
                onClick={() => onEdit(topology)}
              >
                <Edit2 />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer"
                aria-label={`Eliminar ${topology.name}`}
                title="Eliminar topología"
                onClick={() => onDelete(topology)}
              >
                <Trash2 />
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
