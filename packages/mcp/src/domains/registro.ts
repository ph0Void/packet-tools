/**
 * Punto único donde se registran los dominios del servidor MCP.
 *
 * PARA AGREGAR UN DOMINIO NUEVO (esto es todo lo que hay que hacer):
 *   1. Crear `src/domains/<nombre>/index.ts` que exporte un `ModuloDominio`.
 *   2. Importarlo aquí y añadirlo al array `MODULOS`.
 * No hay que tocar el núcleo (`ToolRegistry`, `McpServer`), que es justo el
 * objetivo de la arquitectura.
 */
import { toolRegistry } from "@/core/ToolRegistry";
import type { ModuloDominio } from "@/core/ToolRegistry";

import { moduloPacketTracer } from "@/domains/packetTracer";
import { moduloGns3 } from "@/domains/gns3";
import { moduloSerial } from "@/domains/serial";
import { moduloTelnet } from "@/domains/telnet";
import { moduloSsh } from "@/domains/ssh";
import { moduloPlanes } from "@/domains/plan";
import { moduloSkills } from "@/domains/skills";

/**
 * Módulos del servidor, en orden de carga.
 *
 * El orden solo importa para la presentación (el listado de tools que recibe el
 * modelo mantiene este orden), no para el funcionamiento.
 */
const MODULOS: ModuloDominio[] = [
  moduloPacketTracer,
  moduloGns3,
  moduloSerial,
  moduloTelnet,
  moduloSsh,
  moduloPlanes,
  moduloSkills,
];

let yaRegistrados = false;

/**
 * Registra todos los dominios una sola vez.
 *
 * Es idempotente a propósito: las pruebas construyen el servidor varias veces en
 * el mismo proceso y volver a registrar duplicaría los nombres (el registro lo
 * detectaría y lanzaría, que es lo correcto, pero obligaría a las pruebas a
 * aislarse en procesos distintos sin necesidad).
 */
export function registrarDominios(): void {
  if (yaRegistrados) return;
  for (const modulo of MODULOS) {
    toolRegistry.registrar(modulo);
  }
  yaRegistrados = true;
}
