"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { TopologyRow } from "./types";

interface TopologyEditDialogProps {
  topology: TopologyRow | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    topology: TopologyRow,
    values: { name: string; description: string }
  ) => Promise<boolean>;
}

export default function TopologyEditDialog({
  topology,
  onOpenChange,
  onSubmit,
}: TopologyEditDialogProps) {
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!topology) return;

    const formData = new FormData(e.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!name) {
      toast.error("El nombre de la topología es obligatorio.");
      return;
    }

    setIsPending(true);
    try {
      const ok = await onSubmit(topology, { name, description });
      if (ok) onOpenChange(false);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog
      open={!!topology}
      onOpenChange={(open) => !isPending && onOpenChange(open)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Topología</DialogTitle>
          <DialogDescription>
            Modifica el nombre y la descripción. El diagrama se conserva.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="topology-name">Nombre</Label>
            <Input
              id="topology-name"
              name="name"
              defaultValue={topology?.name ?? ""}
              placeholder="Ej: Topología LAN Sede Central"
              required
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="topology-description">Descripción</Label>
            <Input
              id="topology-description"
              name="description"
              defaultValue={topology?.description ?? ""}
              placeholder="Descripción breve de la topología"
              disabled={isPending}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 data-icon="inline-start" />}
              Guardar cambios
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
