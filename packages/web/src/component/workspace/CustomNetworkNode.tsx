"use client";

import React, { useMemo } from "react";
import { Handle, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Device } from "@/types";
import {
  Cpu,
  Network as NetIcon,
  Laptop,
  Server as ServerIcon,
  Cloud,
  Wifi,
  Phone,
  ShieldAlert,
  Activity,
  HardDrive,
  HelpCircle
} from "lucide-react";

interface NodeProps {
  data: Device;
  selected?: boolean;
}

export default function CustomNetworkNode({ data, selected }: NodeProps) {
  const isOnline = data.power && data.status === "online";

  const Icon = useMemo(() => {
    switch (data.type) {
      case "router":
        return Cpu;
      case "switch":
        return NetIcon;
      case "pc":
        return Laptop;
      case "server":
        return ServerIcon;
      case "cloud_hub":
        return Cloud;
      case "wireless":
        return Wifi;
      case "voip":
        return Phone;
      case "security":
        return ShieldAlert;
      case "iot":
        return Activity;
      case "infrastructure":
        return HardDrive;
      default:
        return HelpCircle;
    }
  }, [data.type]);

  return (
    <div className={`px-4 py-3 rounded-xl border backdrop-blur-md flex items-center gap-3 shadow-lg relative min-w-[160px] select-none transition-colors duration-200 ${isOnline
      ? "bg-slate-950/80 border-sky-500/30 text-slate-100 shadow-sky-500/5 hover:border-sky-500/50"
      : "bg-slate-950/40 border-slate-800/80 text-slate-500"
      } ${selected ? "!border-sky-400 ring-2 ring-sky-400/60" : ""}`}>
      <Handle type="target" position={Position.Top} className="!bg-slate-800 !w-2.5 !h-2.5" />

      <div className={`w-9 h-9 rounded-lg flex items-center justify-center border shrink-0 ${isOnline
        ? "bg-sky-500/10 border-sky-500/20 text-sky-400"
        : "bg-slate-900 border-slate-800 text-slate-600"
        }`}>
        <Icon className={`w-5 h-5 ${isOnline ? "animate-pulse" : ""}`} />
      </div>

      <div className="text-left font-mono">
        <p className="text-xs font-bold truncate max-w-[100px]">{data.name}</p>
        <p className="text-[9px] text-slate-500 mt-0.5">{data.model}</p>
      </div>

      <div className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isOnline ? "bg-emerald-400" : "bg-rose-400"
          }`}></span>
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline ? "bg-emerald-500" : "bg-rose-500"
          }`}></span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-slate-800 !w-2.5 !h-2.5" />
    </div>
  );
}
