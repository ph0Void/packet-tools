"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Edit2, Trash2, Router } from "lucide-react";
import { toast } from "sonner";

interface DeviceProviderItem {
  id: string;
  name: string;
  typeDevice: string;
  protocol: string;
  host: string | null;
  port: number | null;
  serialPort: string | null;
  serialBaudrate: number | null;
  username: string | null;
  password?: string | null;
  status: string;
}

interface DeviceProvidersManagerProps {
  canManage?: boolean;
}

export default function DeviceProvidersManager({
  canManage = true,
}: DeviceProvidersManagerProps) {
  const [devices, setDevices] = useState<DeviceProviderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Partial<DeviceProviderItem> | null>(null);

  const fetchDevices = async () => {
    try {
      const res = await fetch("/api/devices");
      const data = await res.json();
      if (data.success) {
        setDevices(data.data || []);
      } else {
        toast.error(data.message || "Error al cargar dispositivos");
      }
    } catch {
      toast.error("Error al obtener los dispositivos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/devices");
        const data = await res.json();
        if (!active) return;
        if (data.success) {
          setDevices(data.data || []);
        } else {
          toast.error(data.message || "Error al cargar dispositivos");
        }
      } catch {
        if (active) toast.error("Error al obtener los dispositivos.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const refreshDevices = async () => {
    setLoading(true);
    await fetchDevices();
  };

  const handleOpenDialog = (device?: DeviceProviderItem) => {
    if (device) {
      setSelectedDevice(device);
    } else {
      setSelectedDevice({
        name: "",
        typeDevice: "CISCO",
        protocol: "SSH",
        host: "192.168.1.1",
        port: 22,
        serialPort: "COM1",
        serialBaudrate: 9600,
        username: "admin",
        password: "",
        status: "ONLINE",
      });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDevice?.name) {
      toast.error("El nombre del dispositivo es obligatorio.");
      return;
    }

    try {
      const isEdit = !!selectedDevice.id;
      const url = isEdit ? `/api/devices/${selectedDevice.id}` : "/api/devices";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectedDevice),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(isEdit ? "Dispositivo actualizado." : "Dispositivo creado.");
        setIsDialogOpen(false);
        refreshDevices();
      } else {
        toast.error(data.message || "Error al guardar dispositivo.");
      }
    } catch {
      toast.error("Error en la petición.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Seguro de eliminar este dispositivo proveedor?")) return;
    try {
      const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success("Dispositivo eliminado.");
        setDevices((prev) => prev.filter((d) => d.id !== id));
      } else {
        toast.error(data.message || "Error al eliminar.");
      }
    } catch {
      toast.error("Error al eliminar el dispositivo.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Proveedores de Conexión a Dispositivos</h2>
          <p className="text-sm text-muted-foreground">
            Administración de accesos y credenciales para Cisco Packet Tracer, GNS3, SSH, Telnet y Puerto Serial.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => handleOpenDialog()} className="gap-2">
            <Plus className="w-4 h-4" /> Agregar Proveedor
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
              <tr>
                <th className="p-4">Nombre / Hostname</th>
                <th className="p-4">Tipo Dispositivo</th>
                <th className="p-4">Protocolo</th>
                <th className="p-4">Endpoint / IP:Puerto</th>
                <th className="p-4">Puerto Serial / Baudrate</th>
                <th className="p-4">Usuario</th>
                <th className="p-4 text-center">Estado</th>
                <th className="p-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    Cargando dispositivos proveedores...
                  </td>
                </tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No hay proveedores de dispositivos registrados. Registra uno para interactuar.
                  </td>
                </tr>
              ) : (
                devices.map((d) => (
                  <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-4 font-semibold text-foreground">
                      <span className="flex items-center gap-2">
                        <Router className="w-4 h-4 text-primary" />
                        {d.name}
                      </span>
                    </td>
                    <td className="p-4">
                      <Badge variant="outline" className="font-mono text-xs">
                        {d.typeDevice}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {d.protocol}
                      </Badge>
                    </td>
                    <td className="p-4 font-mono text-xs text-muted-foreground">
                      {d.host ? `${d.host}:${d.port || "-"}` : "-"}
                    </td>
                    <td className="p-4 font-mono text-xs text-muted-foreground">
                      {d.serialPort ? `${d.serialPort} @ ${d.serialBaudrate || 9600}` : "-"}
                    </td>
                    <td className="p-4 font-mono text-xs text-muted-foreground">{d.username || "-"}</td>
                    <td className="p-4 text-center">
                      <Badge
                        variant={
                          d.status === "UNREACHABLE"
                            ? "destructive"
                            : d.status === "OFFLINE"
                              ? "outline"
                              : "default"
                        }
                        className="text-xs"
                      >
                        {d.status}
                      </Badge>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1">
                        {canManage && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleOpenDialog(d)}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => handleDelete(d.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {selectedDevice?.id ? "Editar Proveedor de Dispositivo" : "Nuevo Proveedor de Dispositivo"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Nombre Identificador</Label>
                <Input
                  placeholder="Ej: SW-Core-Piso1, Router-Borde-Cisco"
                  value={selectedDevice?.name || ""}
                  onChange={(e) => setSelectedDevice({ ...selectedDevice, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Tipo de Dispositivo</Label>
                <Select
                  value={selectedDevice?.typeDevice || "CISCO"}
                  onValueChange={(val) => setSelectedDevice({ ...selectedDevice, typeDevice: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PACKET_TRACER">Packet Tracer</SelectItem>
                    <SelectItem value="GNS3">GNS3 Server</SelectItem>
                    <SelectItem value="CISCO">Cisco IOS</SelectItem>
                    <SelectItem value="HUAWEI">Huawei VRP</SelectItem>
                    <SelectItem value="ARUBA">Aruba OS</SelectItem>
                    <SelectItem value="MIKROTIK">MikroTik RouterOS</SelectItem>
                    <SelectItem value="GENERIC">Genérico</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Protocolo de Conexión</Label>
                <Select
                  value={selectedDevice?.protocol || "SSH"}
                  onValueChange={(val) => setSelectedDevice({ ...selectedDevice, protocol: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SSH">SSH</SelectItem>
                    <SelectItem value="TELNET">Telnet</SelectItem>
                    <SelectItem value="SERIAL">Puerto Serial</SelectItem>
                    <SelectItem value="SIMULATION">Simulación / API Bridge</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {selectedDevice?.protocol !== "SERIAL" ? (
                <>
                  <div className="space-y-2">
                    <Label>Host / Dirección IP</Label>
                    <Input
                      placeholder="192.168.1.1 o http://localhost:7531"
                      value={selectedDevice?.host || ""}
                      onChange={(e) => setSelectedDevice({ ...selectedDevice, host: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Puerto (ej: 22, 23, 3080)</Label>
                    <Input
                      type="number"
                      placeholder="22"
                      value={selectedDevice?.port ?? 22}
                      onChange={(e) =>
                        setSelectedDevice({ ...selectedDevice, port: parseInt(e.target.value) || null })
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Puerto Serial (COM / tty)</Label>
                    <Input
                      placeholder="COM1, COM6 o /dev/ttyUSB0"
                      value={selectedDevice?.serialPort || ""}
                      onChange={(e) =>
                        setSelectedDevice({ ...selectedDevice, serialPort: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Baud Rate (Baudios)</Label>
                    <Input
                      type="number"
                      placeholder="9600"
                      value={selectedDevice?.serialBaudrate ?? 9600}
                      onChange={(e) =>
                        setSelectedDevice({
                          ...selectedDevice,
                          serialBaudrate: parseInt(e.target.value) || 9600,
                        })
                      }
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>Usuario</Label>
                <Input
                  placeholder="admin"
                  value={selectedDevice?.username || ""}
                  onChange={(e) => setSelectedDevice({ ...selectedDevice, username: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Contraseña</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={selectedDevice?.password || ""}
                  onChange={(e) => setSelectedDevice({ ...selectedDevice, password: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit">Guardar Proveedor</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
