"use client";

import { esReintentable, TEXTO_CORTE, type MotivoCorte } from "@/component/chat/turnoCorte";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Ban, CircleAlert, RotateCcw, Timer, type LucideIcon } from "lucide-react";
import { useState } from "react";

const META: Record<MotivoCorte, { icon: LucideIcon; clase: string }> = {
  cancelado: {
    icon: Ban,
    clase: "border-border bg-card text-muted-foreground",
  },
  presupuesto: {
    icon: Timer,
    clase: "border-warning/30 bg-warning/10 text-muted-foreground",
  },
  error: {
    icon: CircleAlert,
    clase: "border-destructive/30 bg-destructive/10 text-muted-foreground",
  },

  incompleto: {
    icon: Ban,
    clase: "border-border bg-card text-muted-foreground",
  },
};

interface TurnoCorteBarProps {

  motivo: MotivoCorte;

  onReintentar?: () => void | Promise<void>;

  reintentando?: boolean;
}

export function TurnoCorteBar({
  motivo,
  onReintentar,
  reintentando = false,
}: TurnoCorteBarProps) {
  const meta = META[motivo];
  const Icono = meta.icon;
  const reintentable = esReintentable(motivo) && !!onReintentar;

  const [pendiente, setPendiente] = useState(false);
  const ocupado = reintentando || pendiente;

  const reintentar = () => {
    if (!onReintentar || ocupado) return;
    try {
      const resultado = onReintentar();
      if (resultado instanceof Promise) {
        setPendiente(true);

        void resultado.then(
          () => setPendiente(false),
          () => setPendiente(false),
        );
      }
    } catch {

      setPendiente(false);
    }
  };

  return (
    <div
      role="status"
      className={cn(
        "flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-[10px] border px-4 py-2",
        meta.clase,
      )}
    >
      <Icono
        className={cn(
          "size-3.5 shrink-0",
          motivo === "presupuesto" && "text-warning",
          motivo === "error" && "text-destructive",
          (motivo === "cancelado" || motivo === "incompleto") && "text-muted-foreground",
        )}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
        {TEXTO_CORTE[motivo]}
      </p>
      {reintentable && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={reintentar}
          disabled={ocupado}
          aria-label="Reintentar la petición"
          className="shrink-0 cursor-pointer gap-1.5"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          {ocupado ? "Reintentando…" : "Reintentar"}
        </Button>
      )}
    </div>
  );
}

export default TurnoCorteBar;
