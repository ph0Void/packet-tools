"use client";

import React, { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import TopologyTable from "./table/TopologyTable";
import TopologyEditDialog from "./TopologyEditDialog";
import ConfirmDialog from "@/component/ui/ConfirmDialog";
import {
  deleteTopologyAction,
  getTopologyByIdAction,
  saveTopologyAction,
} from "@/action/TopologyAction";
import type { TopologyRow } from "./types";

interface TableTopologyWrapperProps {
  initialTopologies: TopologyRow[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    limit: number;
  };
  canManage: boolean;
}

export default function TableTopologyWrapper({
  initialTopologies,
  pagination,
  canManage,
}: TableTopologyWrapperProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [editingTopology, setEditingTopology] = useState<TopologyRow | null>(null);
  const [deletingTopology, setDeletingTopology] = useState<TopologyRow | null>(null);

  const handlePageChange = (page: number) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    current.set("page", page.toString());
    const query = current.toString();
    router.push(`/dashboard/topology${query ? `?${query}` : ""}`);
  };

  const handleEditSubmit = async (
    topology: TopologyRow,
    values: { name: string; description: string }
  ): Promise<boolean> => {
    try {
      const detail = await getTopologyByIdAction(topology.id);
      if (!detail.success || !detail.data) {
        toast.error(detail.message || "No se pudo obtener la topología.");
        return false;
      }

      const result = await saveTopologyAction(
        values.name,
        values.description,
        detail.data.topologyJson ?? "",
        topology.id
      );

      if (!result.success) {
        toast.error(result.message || "No se pudo guardar la topología.");
        return false;
      }

      toast.success(result.message || "Topología actualizada.");
      startTransition(() => router.refresh());
      return true;
    } catch {
      toast.error("Error al actualizar la topología.");
      return false;
    }
  };

  const handleConfirmDelete = () => {
    if (!deletingTopology) return;
    const target = deletingTopology;

    startTransition(async () => {
      try {
        const result = await deleteTopologyAction(target.id);
        if (result.success) {
          toast.success(result.message || "Topología eliminada.");
          setDeletingTopology(null);
          router.refresh();
        } else {
          toast.error(result.message || "No se pudo eliminar la topología.");
        }
      } catch {
        toast.error("Error al procesar la eliminación.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <TopologyTable
        topologies={initialTopologies}
        canManage={canManage}
        onPageChange={handlePageChange}
        paginationData={pagination}
        onEdit={setEditingTopology}
        onDelete={setDeletingTopology}
      />

      <TopologyEditDialog
        topology={editingTopology}
        onOpenChange={(open) => !open && setEditingTopology(null)}
        onSubmit={handleEditSubmit}
      />

      <ConfirmDialog
        open={!!deletingTopology}
        onOpenChange={(open) => !open && setDeletingTopology(null)}
        title={`Eliminar ${deletingTopology?.name ?? "topología"}`}
        description="Se eliminará la topología junto con su diagrama. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        destructive
        pending={isPending}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
