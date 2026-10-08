"use client";

import { Database, Loader2, Radio } from "lucide-react";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

const BADGE_CONFIG: Record<
  ConnectionStatus,
  { label: string; className: string }
> = {
  connected: {
    label: "LIVE PT",
    className: "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
  },
  connecting: {
    label: "CONECTANDO",
    className: "bg-amber-500/10 border-amber-500/20 text-amber-500",
  },
  disconnected: {
    label: "LOCAL",
    className: "bg-muted border-border text-muted-foreground",
  },
};

export default function BridgeStatusBadge({
  status,
}: {
  status: ConnectionStatus;
}) {
  const config = BADGE_CONFIG[status];

  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-semibold font-mono transition-all ${config.className}`}
    >
      {status === "connected" && (
        <Radio className="w-3 h-3 animate-pulse" aria-hidden="true" />
      )}
      {status === "connecting" && (
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
      )}
      {status === "disconnected" && (
        <Database className="w-3 h-3" aria-hidden="true" />
      )}
      <span>{config.label}</span>
    </div>
  );
}
