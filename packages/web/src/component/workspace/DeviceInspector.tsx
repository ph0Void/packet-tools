"use client";

import { Device } from "@/types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";

interface DeviceInspectorProps {
  device: Device;
  onClose: () => void;
}

const STATUS_STYLES: Record<Device["status"], string> = {
  online: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  offline: "bg-zinc-500/10 border-zinc-500/30 text-zinc-400",
  error: "bg-rose-500/10 border-rose-500/30 text-rose-400",
};

const STATUS_LABELS: Record<Device["status"], string> = {
  online: "En línea",
  offline: "Fuera de línea",
  error: "Con errores",
};

export default function DeviceInspector({
  device,
  onClose,
}: DeviceInspectorProps) {
  const interfaces = Array.isArray(device.interfaces) ? device.interfaces : [];

  return (
    <aside
      aria-label={`Detalles de ${device.name}`}
      className="absolute top-4 right-4 bottom-4 z-20 w-80 max-w-[calc(100vw-2rem)] flex flex-col rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-xl overflow-hidden"
    >
      <header className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-bold truncate">{device.name}</h2>
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            {device.type} · {device.model}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          aria-label="Cerrar inspector"
        >
          <X className="w-4 h-4" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Estado
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Encendido</span>
            <Switch checked={device.power} disabled aria-label="Encendido (solo lectura)" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Operatividad</span>
            <span
              className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${STATUS_STYLES[device.status]}`}
            >
              {STATUS_LABELS[device.status]}
            </span>
          </div>
        </section>

        <section className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Información
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Gateway</dt>
            <dd className="font-mono text-right truncate">
              {device.gateway || "—"}
            </dd>
            <dt className="text-muted-foreground">Posición</dt>
            <dd className="font-mono text-right">
              x: {Math.round(device.x)} · y: {Math.round(device.y)}
            </dd>
          </dl>
        </section>

        <section className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Interfaces ({interfaces.length})
          </p>
          {interfaces.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Sin interfaces reportadas.
            </p>
          ) : (
            <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_1fr] bg-muted/50 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Nombre</span>
                <span>IP</span>
                <span>Máscara</span>
              </div>
              {interfaces.map((itf) => (
                <div
                  key={itf.name}
                  className="grid grid-cols-[1fr_1fr_1fr] px-2 py-1.5 text-[11px] font-mono items-center"
                >
                  <span className="truncate flex items-center gap-1.5">
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                        itf.isUp ? "bg-emerald-500" : "bg-rose-500"
                      }`}
                    />
                    {itf.name}
                  </span>
                  <span className="truncate">{itf.ipAddress || "—"}</span>
                  <span className="truncate">{itf.subnetMask || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
