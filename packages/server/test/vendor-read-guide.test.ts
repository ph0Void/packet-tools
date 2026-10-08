

import { describe, expect, it } from "vitest";
import {
  guiaDeLecturaCanonica,
  resolverGuiaDeVendor,
  GUIAS_DE_VENDOR,
} from "@/agent/security/CanonicalReads";
import { SSH_TOOLS } from "@/agent/ssh/Tool";
import { TELNET_TOOLS } from "@/agent/telnet/Tool";
import { SERIAL_PORT_TOOLS } from "@/agent/serialPort/Tool";
import { SSH_PROMPT } from "@/agent/ssh/Promt";
import { TELNET_PROMPT } from "@/agent/telnet/Promt";
import { SERIAL_PORT_PROMPT } from "@/agent/serialPort/Promt";


const EJEMPLOS_THAT_NO_DEBEN_QUEDAR = [
  "show running-config",
  "display current-configuration",
  "show configuration | display set",
  "show configuration commands",
  "/export",
  "get router info routing-table all",
  "/ip route print",
  "/system resource print",
];

describe("el prompt ya no lleva el catalogo por vendor", () => {
  it("ninguno de los tres prompts contiene un comando por marca", () => {
    for (const prompt of [SSH_PROMPT, TELNET_PROMPT, SERIAL_PORT_PROMPT]) {
      for (const example of EJEMPLOS_THAT_NO_DEBEN_QUEDAR) {
        expect(prompt, `el prompt sigue con "${example}"`).not.toContain(example);
      }
    }
  });

  it("pero conserva la regla y dice donde consultar el catalogo", () => {
    for (const prompt of [SSH_PROMPT, TELNET_PROMPT, SERIAL_PORT_PROMPT]) {
      expect(prompt).toContain("THE MOST COMPLETE READ THAT EXISTS");
      expect(prompt).toContain("canonical read depends on the vendor");
      expect(prompt).toContain("no per-brand list");
      expect(prompt).toContain("get_terminal_status");
      expect(prompt).toContain("lecturasCanonicas");
      
      expect(prompt.indexOf("get_terminal_status")).toBeLessThan(
        prompt.indexOf("use the one that matches the question"),
      );
      
      expect(prompt).toContain("Never guess a command");
    }
  });

  it("los tres especialistas de terminal comparten la misma tool de estado", () => {
    for (const tools of [SSH_TOOLS, TELNET_TOOLS, SERIAL_PORT_TOOLS]) {
      expect(tools.map((t) => t.name)).toContain("get_terminal_status");
    }
  });

  it("get_terminal_status es el que lleva la guia (sin schema nuevo)", () => {
    const status = SSH_TOOLS.find((t) => t.name === "get_terminal_status")!;
    
    expect(Object.keys((status.schema as { shape?: object }).shape ?? {})).toHaveLength(0);
    expect(String(status.description)).toContain("canonical read-only commands");
  });
});

describe("catalogo de lecturas canonicas", () => {
  it("resuelve el vendor que devuelve get_terminal_status", () => {
    expect(resolverGuiaDeVendor("MIKROTIK")?.label).toContain("MikroTik");
    expect(resolverGuiaDeVendor("huawei_vrp")?.label).toContain("Huawei");
    expect(resolverGuiaDeVendor("Cisco IOS 15")?.label).toContain("Cisco");
    expect(resolverGuiaDeVendor("arubaos")?.label).toContain("Aruba");
    expect(resolverGuiaDeVendor("juniper junos")?.label).toContain("JunOS");
    expect(resolverGuiaDeVendor("vyos")?.label).toContain("VyOS");
    expect(resolverGuiaDeVendor("fortigate")?.label).toContain("FortiOS");
  });

  it("devuelve la guia de un solo vendor cuando lo conoce", () => {
    const guide = guiaDeLecturaCanonica("MIKROTIK");
    expect(guide).toContain("MikroTik RouterOS");
    expect(guide).toContain("/system resource print");
    expect(guide).toContain("/ip route print");
    
    expect(guide).not.toContain("Huawei VRP");
    expect(guide).not.toContain("FortiOS");
  });

  it("sin vendor (o desconocido) devuelve la guia completa para poder elegir", () => {
    const full = guiaDeLecturaCanonica();
    for (const guide of GUIAS_DE_VENDOR) {
      expect(full).toContain(guide.label);
    }
    const unknown = guiaDeLecturaCanonica("alcatel-lucent-omniswitch");
    expect(unknown).toContain("No hay guia especifica");
    expect(unknown).toContain("MikroTik RouterOS");
  });

  it("la guia solo propone comandos de lectura y avisa de cuando pedir permiso", () => {
    for (const guide of GUIAS_DE_VENDOR) {
      for (const read of guide.lecturas) {
        const line = read.command.toLowerCase();
        for (const prohibido of ["delete", "erase", "reload", "reboot", "reset", "factory-reset", "write erase", "format"]) {
          expect(line, `${guide.label}: ${read.command}`).not.toContain(prohibido);
        }
      }
    }

    const mikrotik = guiaDeLecturaCanonica("mikrotik");
    expect(mikrotik).toContain("/export");
    expect(mikrotik).toContain("lo descargues si el usuario no lo pide");
  });

  it("la tool get_terminal_status lleva la guia del vendor de la consola", async () => {
    const status = SSH_TOOLS.find((t) => t.name === "get_terminal_status")!;

    const withoutMockConsole = JSON.parse((await status.invoke({})) as string) as {
      alive: boolean;
      readsCanonicas?: string;
    };
    expect(withoutMockConsole.alive).toBe(false);
    expect(withoutMockConsole.readsCanonicas).toBeUndefined();
  });

  it("la guia encaja con lo que el prompt le pide al modelo", () => {

    const guide = guiaDeLecturaCanonica("CISCO").toLowerCase();
    for (const tema of [
      "configuracion",
      "cpu",
      "memoria",
      "direcciones",
      "rutas",
    ]) {
      expect(guide).toContain(tema);
    }
  });
});
