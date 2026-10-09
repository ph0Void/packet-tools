
import { toolRegistry } from "@/core/ToolRegistry";
import type { ModuloDominio } from "@/core/ToolRegistry";

import { moduloPacketTracer } from "@/domains/packetTracer";
import { moduloGns3 } from "@/domains/gns3";
import { moduloSerial } from "@/domains/serial";
import { moduloTelnet } from "@/domains/telnet";
import { moduloSsh } from "@/domains/ssh";
import { moduloPlanes } from "@/domains/plan";
import { moduloSkills } from "@/domains/skills";


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


export function registrarDominios(): void {
  if (yaRegistrados) return;
  for (const modulo of MODULOS) {
    toolRegistry.registrar(modulo);
  }
  yaRegistrados = true;
}
