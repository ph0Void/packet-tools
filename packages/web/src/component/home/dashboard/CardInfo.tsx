"use client";

import React from 'react'
import { Cpu, Network, Laptop, Database, Plug2 } from "lucide-react";
import type { Device } from "@/types";

interface CardInfoProps {
    devices?: Device[];
}

export default function CardInfo({ devices = [] }: CardInfoProps) {

    const metrics = React.useMemo(() => {
        return {
            total: devices.length,
            online: devices.filter(d => d.power && d.status === "online").length,
            routers: devices.filter(d => d.type === "router").length,
            switches: devices.filter(d => d.type === "switch").length,
            pcs: devices.filter(d => d.type === "pc").length,
            servers: devices.filter(d => d.type === "server").length,
            otros: devices.filter(d => !["router", "switch", "pc", "server"].includes(d.type)).length
        };
    }, [devices]);

    return (
        <>

            <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-4 transition-all duration-200 hover:border-primary/30">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Database className="w-5 h-5" />
                </div>
                <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase">Dispositivos Totales</p>
                    <h3 className="text-xl font-bold font-mono">{metrics.total > 0 ? metrics.total - 1 : metrics.total}</h3>
                </div>
            </div>

            {metrics.routers > 0 && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-4 transition-all duration-200 hover:border-primary/30">
                    <div className="p-2 rounded-lg bg-sky-500/10 text-sky-500">
                        <Cpu className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase">Routers</p>
                        <h3 className="text-xl font-bold font-mono">{metrics.routers}</h3>
                    </div>
                </div>
            )}

            {metrics.switches > 0 && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-4 transition-all duration-200 hover:border-primary/30">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
                        <Network className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase">Switches</p>
                        <h3 className="text-xl font-bold font-mono">{metrics.switches}</h3>
                    </div>
                </div>
            )}

            {metrics.pcs > 0 && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-4 transition-all duration-200 hover:border-primary/30">
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                        <Laptop className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase">End Devices / PCs</p>
                        <h3 className="text-xl font-bold font-mono">{metrics.pcs}</h3>
                    </div>
                </div>
            )}

            {(metrics.otros - 1) > 0 && (
                <div className="rounded-xl border border-border bg-card p-4 shadow-sm flex items-center gap-4 transition-all duration-200 hover:border-primary/30">
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                        <Plug2 className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase">Others</p>
                        <h3 className="text-xl font-bold font-mono">{metrics.otros - 1}</h3>
                    </div>
                </div>
            )}

        </>
    )
}
