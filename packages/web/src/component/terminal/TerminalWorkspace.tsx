"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import "@xterm/xterm/css/xterm.css";
import {
  Loader2,
  MonitorCog,
  PlugZap,
  Power,
  Sparkles,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getSocket } from "@/hooks/useCiscoSocket";
import { useTerminalStore, type TerminalStatus } from "@/store/terminal.store";
import { useUiStore } from "@/store/uiStore";
import { cn } from "@/lib/utils";

import { TerminalConsole } from "./terminal-console";

export type TerminalRole = "USER" | "STAFF" | "ADMIN";

interface DeviceOption {
  id: string;
  name: string;
  protocol: string;
  host: string | null;
  port: number | null;
  username: string | null;
  serialPort: string | null;
  serialBaudrate: number | null;
  status: string;
}

interface ManualForm {
  type: "SSH" | "TELNET" | "SERIAL";
  host: string;
  port: string;
  username: string;
  password: string;
  serialPort: string;
  baudRate: string;
}

const EMPTY_MANUAL: ManualForm = {
  type: "SSH",
  host: "",
  port: "",
  username: "",
  password: "",
  serialPort: "",
  baudRate: "",
};

const PROTOCOL_GROUPS = ["SSH", "TELNET", "SERIAL"] as const;

const ANSI = {
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const STATUS_META: Record<
  TerminalStatus,
  { label: string; dot: string; badgeClass: string }
> = {
  DISCONNECTED: {
    label: "Desconectado",
    dot: "bg-muted-foreground/60",
    badgeClass: "border-border/60 bg-muted/40 text-muted-foreground",
  },
  CONNECTING: {
    label: "Conectando…",
    dot: "bg-amber-500 animate-pulse dark:bg-amber-400",
    badgeClass:
      "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  CONNECTED: {
    label: "En línea",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    badgeClass:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

export function TerminalWorkspace({ role }: { role: TerminalRole }) {
  const status = useTerminalStore((s) => s.status);
  const deviceProviderId = useTerminalStore((s) => s.deviceProviderId);
  const setDeviceProviderId = useTerminalStore((s) => s.setDeviceProviderId);
  const localEcho = useTerminalStore((s) => s.localEcho);
  const setLocalEcho = useTerminalStore((s) => s.setLocalEcho);

  const isChatPanelOpen = useUiStore((s) => s.isChatPanelOpen);
  const toggleChatPanel = useUiStore((s) => s.toggleChatPanel);

  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<ManualForm>(EMPTY_MANUAL);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/devices", {
          credentials: "include",
          cache: "no-store",
        });
        const json = (await res.json()) as {
          success?: boolean;
          data?: DeviceOption[];
        };
        if (!active) return;
        setDevices(json.success && Array.isArray(json.data) ? json.data : []);
      } catch {
        if (active) toast.error("No se pudieron cargar los dispositivos");
      } finally {
        if (active) setLoadingDevices(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const storedId = window.sessionStorage.getItem("pt-selected-device");
    if (!storedId) return;
    window.sessionStorage.removeItem("pt-selected-device");
    setDeviceProviderId(storedId); // preselección sin auto-conectar
  }, [setDeviceProviderId]);

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === deviceProviderId) ?? null,
    [devices, deviceProviderId],
  );

  const grouped = useMemo<
    Array<{ protocol: string; items: DeviceOption[] }>
  >(() => {
    const known = new Set<string>(PROTOCOL_GROUPS);
    const groups: Array<{ protocol: string; items: DeviceOption[] }> =
      PROTOCOL_GROUPS.map((protocol) => ({
        protocol,
        items: devices.filter(
          (d) => (d.protocol ?? "").toUpperCase() === protocol,
        ),
      })).filter((g) => g.items.length > 0);
    const others = devices.filter(
      (d) => !known.has((d.protocol ?? "").toUpperCase()),
    );
    if (others.length > 0) groups.push({ protocol: "OTROS", items: others });
    return groups;
  }, [devices]);

  const startSession = useCallback(
    (
      payload: Record<string, unknown>,
      protocol: string | null,
      name: string | null,
    ) => {
      const socket = getSocket();

      if (!socket.connected) {
        toast.error(
          "Sin conexión con el servidor. Revisa la sesión o reinicia la aplicación.",
        );
        useTerminalStore.getState().setStatus("DISCONNECTED");
        return;
      }
      socket.emit("terminal:disconnect");

      useTerminalStore.getState().setLastConnectPayload(payload);
      useTerminalStore.getState().clearInjections();

      useTerminalStore.getState().setActiveSessionInfo({
        sessionId: null,
        protocol,
        deviceName: name,
      });
      useTerminalStore.getState().setStatus("CONNECTING");
      socket.emit("terminal:connect", payload);
    },
    [],
  );

  const handleConnectSelected = useCallback(() => {
    if (!selectedDevice) {
      toast.warning("Selecciona un dispositivo o usa conexión manual");
      return;
    }
    startSession(
      { providerId: selectedDevice.id },
      selectedDevice.protocol,
      selectedDevice.name,
    );
  }, [selectedDevice, startSession]);

  const handleDisconnect = useCallback(() => {
    const socket = getSocket();
    if (socket.connected) socket.emit("terminal:disconnect");
    useTerminalStore.getState().setStatus("DISCONNECTED");
  }, []);

  const handleConnectManual = useCallback(() => {
    const { type, host, port, username, password, serialPort, baudRate } =
      manual;
    const payload: Record<string, unknown> = { type };
    if (type === "SERIAL") {
      if (!serialPort.trim()) {
        toast.warning("Indica el puerto serie (ej. COM3)");
        return;
      }
      payload.serialPort = serialPort.trim();
      if (baudRate.trim()) payload.baudRate = Number(baudRate);
    } else {
      if (!host.trim()) {
        toast.warning("Indica el host para la conexión manual");
        return;
      }
      payload.host = host.trim();
      if (port.trim()) payload.port = Number(port);
      if (username.trim()) payload.username = username.trim();
      if (password) payload.password = password;
    }
    setManualOpen(false);
    startSession(payload, type, "conexión manual");
  }, [manual, startSession]);

  const meta = STATUS_META[status];

  return (
    <div className="flex h-full min-h-[480px] ">

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="shrink-0 rounded-xl border border-border/40 bg-muted/30 p-3 md:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TerminalIcon className="size-4 text-primary" />
              <h1 className="text-2xl font-semibold tracking-wide text-foreground">
                Terminal
              </h1>
            </div>
            <Badge variant="outline" className={cn("gap-1.5", meta.badgeClass)}>
              <span className={cn("size-1.5 rounded-full", meta.dot)} />
              {meta.label}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Select
              value={deviceProviderId ?? ""}
              onValueChange={(value) => setDeviceProviderId(value)}
            >
              <SelectTrigger
                disabled={loadingDevices}
                className="w-full bg-background sm:w-64"
                aria-label="Dispositivo a conectar"
              >
                <SelectValue
                  placeholder={
                    loadingDevices
                      ? "Cargando dispositivos…"
                      : devices.length === 0
                        ? "Sin dispositivos disponibles"
                        : "Seleccionar dispositivo"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {grouped.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No hay dispositivos registrados todavía.
                  </p>
                ) : (
                  grouped.map((group) => (
                    <SelectGroup key={group.protocol}>
                      <SelectLabel>{group.protocol}</SelectLabel>
                      {group.items.map((device) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))
                )}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              className="cursor-pointer"
              onClick={() => setManualOpen(true)}
            >
              <MonitorCog data-icon="inline-start" />
              Manual
            </Button>

            {role !== "USER" && (
              <label className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1">
                <Switch checked={localEcho} onCheckedChange={setLocalEcho} />
                <span className="hidden text-sm font-medium text-foreground sm:inline">
                  Eco local
                </span>
              </label>
            )}

            <div className="flex gap-2 sm:ml-auto">
              {status === "CONNECTED" ? (
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  className="cursor-pointer border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20 hover:text-red-600 dark:border-red-400/40 dark:text-red-400 dark:hover:text-red-300"
                >
                  <Power data-icon="inline-start" />
                  Desconectar
                </Button>
              ) : (
                <Button
                  className="cursor-pointer"
                  onClick={handleConnectSelected}
                  disabled={loadingDevices}
                >
                  {status === "CONNECTING" ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <PlugZap data-icon="inline-start" />
                  )}
                  Conectar
                </Button>
              )}

              <Button
                onClick={toggleChatPanel}
                aria-pressed={isChatPanelOpen}
                variant="outline"
                className={
                  "cursor-pointer " +
                  cn(
                    "border-primary/40 text-primary hover:bg-primary/10 hover:text-primary",
                    isChatPanelOpen &&
                      "bg-primary/10 shadow-[0_0_14px_color-mix(in_srgb,var(--primary)_35%,transparent)]",
                  )
                }
              >
                {isChatPanelOpen ? (
                  <X data-icon="inline-start" />
                ) : (
                  <Sparkles data-icon="inline-start" />
                )}
                Asistente IA
              </Button>
            </div>
          </div>
        </div>

        {!loadingDevices && devices.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center">
            <div className="rounded-full bg-muted/60 p-3">
              <MonitorCog className="size-6 text-muted-foreground" />
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">
              Aún no hay dispositivos registrados. Crea uno para poder
              conectarte a la consola.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="cursor-pointer"
            >
              <Link href="/dashboard/connection">Ir a dispositivos</Link>
            </Button>
          </div>
        )}

        <TerminalConsole role={role} className="flex-1" />
      </div>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conexión manual</DialogTitle>
            <DialogDescription>
              Conecta por SSH, Telnet o puerto serie sin dispositivo guardado.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="manual-type">Tipo</Label>
              <Select
                value={manual.type}
                onValueChange={(value) =>
                  setManual((prev) => ({
                    ...prev,
                    type: value as ManualForm["type"],
                  }))
                }
              >
                <SelectTrigger id="manual-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SSH">SSH</SelectItem>
                  <SelectItem value="TELNET">Telnet</SelectItem>
                  <SelectItem value="SERIAL">Serie</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {manual.type === "SERIAL" ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="manual-serial">Puerto serie</Label>
                  <Input
                    id="manual-serial"
                    placeholder="COM3"
                    value={manual.serialPort}
                    onChange={(e) =>
                      setManual((prev) => ({
                        ...prev,
                        serialPort: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="manual-baud">Baudrate</Label>
                  <Input
                    id="manual-baud"
                    inputMode="numeric"
                    placeholder="9600"
                    value={manual.baudRate}
                    onChange={(e) =>
                      setManual((prev) => ({
                        ...prev,
                        baudRate: e.target.value,
                      }))
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                  <div className="grid gap-1.5">
                    <Label htmlFor="manual-host">Host</Label>
                    <Input
                      id="manual-host"
                      placeholder="192.168.1.1"
                      value={manual.host}
                      onChange={(e) =>
                        setManual((prev) => ({ ...prev, host: e.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="manual-port">Puerto</Label>
                    <Input
                      id="manual-port"
                      inputMode="numeric"
                      placeholder={manual.type === "SSH" ? "22" : "23"}
                      value={manual.port}
                      onChange={(e) =>
                        setManual((prev) => ({ ...prev, port: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="manual-user">Usuario</Label>
                    <Input
                      id="manual-user"
                      autoComplete="off"
                      value={manual.username}
                      onChange={(e) =>
                        setManual((prev) => ({
                          ...prev,
                          username: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="manual-password">Contraseña</Label>
                    <Input
                      id="manual-password"
                      type="password"
                      autoComplete="new-password"
                      value={manual.password}
                      onChange={(e) =>
                        setManual((prev) => ({
                          ...prev,
                          password: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              className="cursor-pointer"
              variant="ghost"
              onClick={() => setManualOpen(false)}
            >
              Cancelar
            </Button>
            <Button className="cursor-pointer" onClick={handleConnectManual}>
              <PlugZap data-icon="inline-start" />
              Conectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
