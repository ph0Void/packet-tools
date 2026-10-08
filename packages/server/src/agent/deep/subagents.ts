import type { CompiledSubAgent } from "deepagents";
import { createCiscoPacketTracerAgent } from "../ciscoPacketTracer/Agent";
import { createGns3Agent } from "../gns3/Agent";
import { createSshAgent } from "../ssh/Agent";
import { createTelnetAgent } from "../telnet/Agent";
import { createSerialPortAgent } from "../serialPort/Agent";
import { createKnowledgeAgent } from "../knowledge/Agent";
import { createSystemAdminAgent } from "../systemAdmin/Agent";
import type { DeepConnection } from "./context";

export interface SubAgentsOptions {
  modelProviderId?: string;
  role: string;

  connection?: DeepConnection | null;
}

const DESCRIPCIONES = {
  packetTracer:
    "Topologías y dispositivos en Cisco Packet Tracer: crear/editar Redes, añadir módulos, enlaces, configurar IP de PC e IOS, simular PDUs y diagnosticar conectividad.",
  gns3: "Laboratorios GNS3: proyectos, nodos, enlaces, snapshots, plantillas, capturas, consola de nodos y exportación/importación de proyectos.",
  ssh: "Equipos reales accesibles por SSH: ejecutar comandos de configuración o diagnóstico sobre la consola abierta del dispositivo.",
  telnet: "Equipos reales accesibles por Telnet (legacy): ejecutar comandos sobre la consola del dispositivo.",
  serial: "Equipos reales accesibles por puerto serie (RS-232/USB-serial): comandos uno a uno sobre la consola del dispositivo.",
  knowledge:
    "Base de conocimiento y documentación: RAG interno, documentos de fabricante y búsqueda en internet cuando la base local no basta.",
  systemAdmin:
    "Administración de la propia plataforma: tareas programadas (cronjobs), conexiones/dispositivos, configuración global y contadores del sistema.",
} as const;

export async function buildNetworkSubAgents(
  options: SubAgentsOptions,
): Promise<CompiledSubAgent[]> {
  const { modelProviderId, role, connection } = options;
  const esPrivilegiado = role === "ADMIN" || role === "STAFF";

  const [packetTracer, gns3, ssh, telnet, serial, knowledge, systemAdmin] =
    await Promise.all([
      createCiscoPacketTracerAgent(modelProviderId, role),
      createGns3Agent(
        modelProviderId,
        role,
        connection
          ? {
              name: connection.name,
              host: null,
              typeDevice: connection.typeDevice,
            }
          : null,
      ),
      createSshAgent(modelProviderId, role),
      createTelnetAgent(modelProviderId, role),
      createSerialPortAgent(modelProviderId, role),
      createKnowledgeAgent(modelProviderId, role),

      esPrivilegiado ? createSystemAdminAgent(modelProviderId, role) : null,
    ]);

  const subagents: CompiledSubAgent[] = [
    {
      name: "packet_tracer_specialist",
      description: DESCRIPCIONES.packetTracer,
      runnable: packetTracer,
    },
    {
      name: "gns3_specialist",
      description: DESCRIPCIONES.gns3,
      runnable: gns3,
    },
    {
      name: "ssh_specialist",
      description: DESCRIPCIONES.ssh,
      runnable: ssh,
    },
    {
      name: "telnet_specialist",
      description: DESCRIPCIONES.telnet,
      runnable: telnet,
    },
    {
      name: "serial_specialist",
      description: DESCRIPCIONES.serial,
      runnable: serial,
    },
    {
      name: "knowledge_specialist",
      description: DESCRIPCIONES.knowledge,
      runnable: knowledge,
    },
  ];

  if (systemAdmin) {
    subagents.push({
      name: "system_admin_specialist",
      description: DESCRIPCIONES.systemAdmin,
      runnable: systemAdmin,
    });
  }

  return subagents;
}

export const NETWORK_SUBAGENT_NAMES = [
  "packet_tracer_specialist",
  "gns3_specialist",
  "ssh_specialist",
  "telnet_specialist",
  "serial_specialist",
] as const;

export function puedeAdministrarSistema(role: string): boolean {
  return esPrivilegiado(role);
}

function esPrivilegiado(role: string): boolean {
  return role === "ADMIN" || role === "STAFF";
}
