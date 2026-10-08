

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TerminalSessionHub,
  terminalSessionHub,
  type TerminalSession,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";
import { classifyCommands } from "@/agent/security/CommandClassifier";
import { getVendorProfile } from "@/agent/security/VendorProfile";
import { getToolPolicy } from "@/agent/security/ToolPolicy";
import { TERMINAL_TOOLS } from "@/agent/tools/TerminalTools";
import { requestContext, type RequestUser } from "@/utils/RequestContext";


const FAST = { idleMs: 40, maxMs: 1_200 };


interface ScriptCommand {
  
  responde?: string;
  
  promptFinal?: string | null;
  
  trasReturn?: boolean;
  
  teclasPerdidas?: number;
}


interface Script {
  
  prompt: string | null;
  
  typeDevice?: string;
  
  commands?: Record<string, ScriptCommand>;
  
  promptByDefecto?: string;
  
  outputOfConfig?: { command: string; niveles: readonly string[] };
}


interface MockConsoleFake {
  
  escrito: string[];
  
  commands: string[];
  
  session: TerminalSession;
  
  fijaPrompt(prompt: string): void;
}

function registra(
  hub: TerminalSessionHub,
  socketId: string,
  script: Script,
  overrides: Partial<TerminalSessionRegistration> = {},
): MockConsoleFake {
  const escrito: string[] = [];
  const commands: string[] = [];
  let promptCurrent = script.prompt;
  
  let indexOutput = 0;

  hub.register({
    socketId,
    userId: "u1",
    providerId: "p1",
    protocol: "TELNET",
    deviceName: "equipo",
    fingerprint: null,
    typeDevice: script.typeDevice ?? null,
    write: (data: string) => {
      const text = String(data);
      escrito.push(text);
      
      if (!text.trim()) return;
      const line = text.replace(/\r\n?|\n/g, "").trim();
      commands.push(line);
      const definicion = script.commands?.[line];
      setTimeout(() => {
        
        const perdidas = definicion?.teclasPerdidas ?? 0;
        if (perdidas !== 0) {
          if (perdidas > 0 && definicion) definicion.teclasPerdidas = perdidas - 1;
          hub.recordData(socketId, `\r\n${promptCurrent ?? ""}`);
          return;
        }

        const output = script.outputOfConfig;
        if (output && output.command === line && output.niveles.length > 0) {
          const last = output.niveles.length - 1;
          promptCurrent = output.niveles[indexOutput <= last ? indexOutput : last];
          indexOutput += 1;
          hub.recordData(socketId, `\r\n${promptCurrent ?? ""}`);
          return;
        }
        if (definicion?.promptFinal !== undefined) promptCurrent = definicion.promptFinal;
        else if (script.promptByDefecto !== undefined) promptCurrent = script.promptByDefecto;
        const cuerpo = definicion?.responde ? `${definicion.responde}\r\n` : "";

        hub.recordData(socketId, `\r\n${cuerpo}${promptCurrent ?? ""}`);
      }, 5);
    },
    isAlive: () => true,
    ...overrides,
  });

  if (script.prompt) hub.recordData(socketId, `\r\n${script.prompt}`);

  return {
    escrito,
    commands,
    session: hub.get(socketId)!,
    fijaPrompt: (prompt: string) => {
      promptCurrent = prompt;
      hub.recordData(socketId, `\r\n${prompt}`);
    },
  };
}

describe("runConfigDetailed: el plan sale del VendorProfile", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  it("Cisco: preámbulo + enable + configure terminal + lote + exit", async () => {
    const mockConsole = registra(hub, "s1", {
      prompt: "R1>",
      typeDevice: "CISCO",
      commands: {
        enable: { promptFinal: "R1#" },
        "configure terminal": { promptFinal: "R1(config)#" },
        exit: { promptFinal: "R1#" },
      },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["interface GigabitEthernet0/1", "description uplink"],
      ...FAST,
    });


    expect(mockConsole.commands).toEqual([
      "terminal length 0",
      "no ip domain-lookup",
      "enable",
      "configure terminal",
      "interface GigabitEthernet0/1",
      "description uplink",
      "exit",
    ]);
    expect(mockConsole.escrito.every((t) => t.endsWith("\r") && !t.includes("\n"))).toBe(true);
    expect(r.abortado).toBe(false);
    expect(r.vendor).toBe("cisco");
    expect(r.entramosEnConfig).toBe(true);
    expect(r.modeFinal).toBe("privilegiado");
    expect(r.promptFinal).toBe("R1#");
    expect(r.pasos.every((p) => p.status === "enviado")).toBe(true);
  });

  it("Cisco: si el prompt ya es privilegiado y de configuración, no repite transiciones", async () => {
    const mockConsole = registra(hub, "s1", { prompt: "R1(config)#", typeDevice: "CISCO" });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["hostname R1"],
      ...FAST,
    });


    expect(mockConsole.commands).toEqual([
      "terminal length 0",
      "no ip domain-lookup",
      "hostname R1",
    ]);
    const omitidas = r.plan.omitidas.filter(
      (o) => o.fase === "privilegio" || o.fase === "config" || o.fase === "salida",
    );
    expect(omitidas.map((o) => o.fase)).toEqual(["privilegio", "config", "salida"]);
    expect(omitidas[0].porque).toMatch(/ya es privilegiado/);
    expect(omitidas[1].porque).toMatch(/ya es el modo configuración/);
    expect(omitidas[2].porque).toMatch(/no se entró en modo configuración/);
  });

  it("Huawei: system-view en vez de configure terminal, y sale con quit", async () => {
    const mockConsole = registra(hub, "s1", {
      prompt: "<Huawei>",
      typeDevice: "HUAWEI",

      outputOfConfig: { command: "quit", niveles: ["[Huawei]", "<Huawei>"] },
      commands: {
        "system-view": { promptFinal: "[Huawei]" },
        "interface GigabitEthernet0/0/0": { promptFinal: "[Huawei-GigabitEthernet0/0/0]" },
      },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["interface GigabitEthernet0/0/0"],
      guardar: true,
      ...FAST,
    });

    expect(mockConsole.commands).toEqual([
      "screen-length 0 temporary",
      "undo ip domain-lookup",
      "system-view",
      "interface GigabitEthernet0/0/0",
      "save",
      "quit",
      "quit",
    ]);
    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(2);
    expect(r.guardado).toBe(true);

    expect(r.modeFinal).toBe("usuario");
  });

  it("MikroTik: sin modo configuración, sin preámbulo y sin guardado inventados", async () => {

    const mockConsole = registra(hub, "s1", {
      prompt: "[admin@core-r1] >",
      typeDevice: "MIKROTIK",
      commands: {
        "/interface bridge": { promptFinal: "[admin@core-r1] /interface bridge>" },
      },

      outputOfConfig: { command: "..", niveles: ["[admin@core-r1] >"] },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["/interface bridge"],
      guardar: true,
      ...FAST,
    });


    expect(mockConsole.commands).toEqual(["/interface bridge", ".."]);
    const phases = r.plan.omitidas.map((o) => o.fase);
    expect(phases).toContain("preambulo");
    expect(phases).toContain("config");
    expect(phases).toContain("guardar");
    expect(r.plan.omitidas.find((o) => o.fase === "guardar")?.porque).toMatch(/persistente/);

    expect(r.plan.lines.map((l) => l.command)).toContain("..");

    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(1);
    expect(r.modeFinal).toBe("privilegiado");
    expect(r.promptFinal).toBe("[admin@core-r1] >");
  });

  it("JunOS: el prompt NO distingue `configure`, así que el motor no lo repite", async () => {

    const mockConsole = registra(hub, "s1", {
      prompt: "user@vsrx>",

      typeDevice: null,
      commands: {},
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["set system host-name vsrx-1"],
      guardar: true,
      ...FAST,
    });

    expect(r.vendor).toBe("junos");
    expect(mockConsole.commands).toEqual([
      "set cli screen-length 0",
      "set system host-name vsrx-1",
      "commit",
    ]);
    expect(mockConsole.commands).not.toContain("exit");
    expect(r.guardado).toBe(true);

    expect(r.modoIndeterminado).toBe(true);
    const omitidas = r.plan.omitidas.map((o) => o.fase);
    expect(omitidas).toContain("config");
    expect(omitidas).toContain("salida");
  });

  it("sin vendor identificado: no inventa transiciones pero sí aplica el lote", async () => {
    const mockConsole = registra(hub, "s1", { prompt: "rtr>" });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["set hostname rtr"],
      guardar: true,
      ...FAST,
    });

    expect(r.vendor).toBe("conservative");
    expect(mockConsole.commands).toEqual(["set hostname rtr"]);
    expect(r.plan.lines).toHaveLength(1);
    expect(r.plan.omitidas.length).toBeGreaterThanOrEqual(4);
    expect(
      r.plan.omitidas.every((o) => typeof o.porque === "string" && o.porque.length > 20),
    ).toBe(true);
  });

  it("el logout del lote nunca se manda y el exit interno solo si sigue en sub-modo", async () => {
    const mockConsole = registra(hub, "s1", {
      prompt: "R1#",
      typeDevice: "CISCO",
      commands: { "configure terminal": { promptFinal: "R1(config)#" }, exit: { promptFinal: "R1#" } },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["hostname R1", "exit", "logout"],
      ...FAST,
    });


    expect(mockConsole.commands).toEqual([
      "terminal length 0",
      "no ip domain-lookup",
      "configure terminal",
      "hostname R1",
      "exit",
    ]);
    const omitidos = r.pasos.filter((p) => p.status === "omitido");

    expect(omitidos.map((p) => p.command)).toEqual(["logout", "exit"]);
    expect(omitidos[0].detail).toMatch(/cerraría la sesión interactiva/);
    expect(omitidos[1].fase).toBe("salida");
    expect(omitidos[1].detail).toMatch(/cerraría la consola interactiva/);
    expect(r.modeFinal).toBe("privilegiado");
  });

  it("no manda el exit de salida si el prompt no es un sub-modo del perfil", async () => {

    const mockConsole = registra(hub, "s1", {
      prompt: "R1#",
      typeDevice: "CISCO",
      promptByDefecto: "R1#",
      commands: { "configure terminal": { responde: "% Ambiguous command", promptFinal: "R1#" } },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["hostname R1"],
      ...FAST,
    });

    const output = r.pasos.find((p) => p.fase === "salida");
    expect(output?.status).toBe("omitido");
    expect(output?.detail).toMatch(/cerraría la consola interactiva/);
    expect(mockConsole.commands[mockConsole.commands.length - 1]).toBe("hostname R1");
  });
});

describe("runConfigDetailed: la salida del modo configuración se COMPRUEBA", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });



  function teamNestable(perdidas: number): Script {
    return {
      prompt: "R1#",
      typeDevice: "CISCO",
      commands: {
        "configure terminal": { promptFinal: "R1(config)#" },
        "interface FastEthernet0/0": { promptFinal: "R1(config-if)#" },
        exit: { teclasPerdidas: perdidas },
        "show running-config | include description": {
          responde: "description PT-PROBA-532855",
          promptFinal: "R1#",
        },
      },
      outputOfConfig: { command: "exit", niveles: ["R1(config)#", "R1#"] },
    };
  }

  it("de `(config-if)#` envía el exit las veces que haga falta y vuelve a `R1#`", async () => {
    const mockConsole = registra(hub, "s1", teamNestable(0));

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["interface FastEthernet0/0", "description PT-PROBA-532855"],
      verifyCommands: ["show running-config | include description"],
      ...FAST,
    });


    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(2);
    expect(mockConsole.commands.filter((c) => c === "exit")).toHaveLength(2);
    expect(r.modeFinal).toBe("privilegiado");
    expect(r.promptFinal).toBe("R1#");
    expect(r.abortado).toBe(false);
    expect(r.avisoSalida).toBeNull();

    expect(r.verificacion?.completa).toBe(true);
    expect(r.verificacion?.resultados[0].output).toContain("PT-PROBA-532855");
  });

  it("un exit que el equipo PIERDE se reintenta y sale al siguiente intento", async () => {

    const mockConsole = registra(hub, "s1", teamNestable(1));

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["interface FastEthernet0/0", "description PT-PROBA-532855"],
      verifyCommands: ["show running-config | include description"],
      ...FAST,
    });


    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(3);
    expect(r.modeFinal).toBe("privilegiado");
    expect(r.abortado).toBe(false);

    expect(r.pasos.filter((p) => p.fase === "salida")).toHaveLength(3);
    expect(r.verificacion?.completa).toBe(true);
  });

  it("si no hay manera de salir, ABORTA con aviso honesto (no un success:true)", async () => {
    const mockConsole = registra(hub, "s1", teamNestable(-1));

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["interface FastEthernet0/0", "description PT-PROBA-532855"],
      verifyCommands: ["show running-config | include description"],
      ...FAST,
    });

    expect(r.salioDeConfig).toBe(false);
    expect(r.abortado).toBe(true);
    expect(r.motivoAborto).toBe("no_se_sale_de_config");

    expect(r.avisoSalida).toMatch(/R1\(config-if\)#/);
    expect(r.avisoSalida).toMatch(/configuración de interfaz/);
    expect(r.avisoSalida).toMatch(/sal de ese modo a mano/);
    expect(r.avisoSalida).toMatch(/NO des el ciclo por cerrado/);
    expect(r.motivoAbortoTexto).toBe(r.avisoSalida);

    expect(r.intentosSalida).toBeGreaterThan(1);
    expect(r.intentosSalida).toBeLessThanOrEqual(4);

    expect(r.verificacion?.completa).toBe(false);
    expect(r.verificacion?.reason).toMatch(/no_se_sale_de_config/);
    expect(r.verificacion?.resultados).toHaveLength(0);
    expect(mockConsole.commands).not.toContain("show running-config | include description");

    expect(mockConsole.commands).toContain("description PT-PROBA-532855");
  });

  it("nunca escribe un exit cuando el lote del agente ya salió (ni por costumbre)", async () => {

    const mockConsole = registra(hub, "s1", {
      prompt: "R1#",
      typeDevice: "CISCO",
      commands: { "configure terminal": { promptFinal: "R1(config)#" } },
      outputOfConfig: { command: "exit", niveles: ["R1#"] },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["hostname R1", "exit"],
      ...FAST,
    });

    expect(mockConsole.commands.filter((c) => c === "exit")).toHaveLength(1);
    expect(r.intentosSalida).toBe(0);
    expect(r.salioDeConfig).toBe(true);
    expect(r.modeFinal).toBe("privilegiado");
    expect(r.abortado).toBe(false);
    const output = r.pasos.find((p) => p.fase === "salida");
    expect(output?.status).toBe("omitido");
    expect(output?.detail).toMatch(/cerraría la consola interactiva/);
  });

  it("RouterOS: el lote entra en un menú y el motor lo SACA con `..`", async () => {

    const mockConsole = registra(hub, "s1", {
      prompt: "[admin@MikroTik] >",
      typeDevice: "MIKROTIK",
      commands: {
        "/system identity": { promptFinal: "[admin@MikroTik] /system identity>" },
        "set name=PT-PROBA": { responde: "name: PT-PROBA" },
        "/system identity print": { responde: "name: PT-PROBA", promptFinal: "[admin@MikroTik] >" },
      },
      outputOfConfig: { command: "..", niveles: ["[admin@MikroTik] >"] },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["/system identity", "set name=PT-PROBA"],
      verifyCommands: ["/system identity print"],
      ...FAST,
    });


    expect(mockConsole.commands).toEqual([
      "/system identity",
      "set name=PT-PROBA",
      "..",
      "/system identity print",
    ]);
    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(1);
    expect(r.modeFinal).toBe("privilegiado");
    expect(r.promptFinal).toBe("[admin@MikroTik] >");
    expect(r.abortado).toBe(false);
    expect(r.avisoSalida).toBeNull();

    expect(r.verificacion?.completa).toBe(true);
    expect(r.verificacion?.resultados[0].output).toContain("name: PT-PROBA");
  });

  it("RouterOS: un menú ANIDADO necesita varios `..` (uno por nivel, con tope)", async () => {

    const mockConsole = registra(hub, "s1", {
      prompt: "[admin@MikroTik] >",
      typeDevice: "MIKROTIK",
      commands: {
        "/interface ethernet switch": { promptFinal: "[admin@MikroTik] /interface ethernet switch>" },
        "add name=puente1": { responde: "0 R name=puente1" },
      },

      outputOfConfig: {
        command: "..",
        niveles: [
          "[admin@MikroTik] /interface ethernet>",
          "[admin@MikroTik] /interface>",
          "[admin@MikroTik] >",
        ],
      },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["/interface ethernet switch", "add name=puente1"],
      ...FAST,
    });

    expect(mockConsole.commands.filter((c) => c === "..")).toHaveLength(3);
    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(3);

    expect(r.intentosSalida).toBeLessThanOrEqual(4);
    expect(r.promptFinal).toBe("[admin@MikroTik] >");
    expect(r.abortado).toBe(false);
  });

  it("RouterOS: en la raíz NO se escribe nunca `..` aunque el plan lo traiga", async () => {

    const mockConsole = registra(hub, "s1", {
      prompt: "[admin@MikroTik] >",
      typeDevice: "MIKROTIK",
      commands: { "/interface print": { responde: "0 R name=ether1" } },
      outputOfConfig: { command: "..", niveles: ["[admin@MikroTik] >"] },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["/interface print"],
      ...FAST,
    });

    expect(mockConsole.commands).toEqual(["/interface print"]);
    expect(mockConsole.commands).not.toContain("..");

    const output = r.pasos.find((p) => p.fase === "salida");
    expect(output?.status).toBe("omitido");
    expect(output?.detail).toMatch(/no es un sub-modo/);
    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(0);
    expect(r.abortado).toBe(false);
  });

  it("RouterOS: un `..` que el equipo se traga se reintenta con tope y avisa si no sale", async () => {

    const script = (teclasPerdidas: number): Script => ({
      prompt: "[admin@MikroTik] >",
      typeDevice: "MIKROTIK",
      commands: {
        "/system identity": { promptFinal: "[admin@MikroTik] /system identity>" },
        "set name=PT-PROBA": { responde: "name: PT-PROBA" },
        "..": { teclasPerdidas },
      },
      outputOfConfig: { command: "..", niveles: ["[admin@MikroTik] >"] },
    });

    const recupera = registra(hub, "s1", script(1));
    const r1 = await hub.runConfigDetailed(recupera.session, {
      commands: ["/system identity", "set name=PT-PROBA"],
      ...FAST,
    });

    expect(recupera.commands.filter((c) => c === "..")).toHaveLength(2);
    expect(r1.salioDeConfig).toBe(true);
    expect(r1.promptFinal).toBe("[admin@MikroTik] >");

    hub.clear();
    const atascado = registra(hub, "s1", script(-1));
    const r2 = await hub.runConfigDetailed(atascado.session, {
      commands: ["/system identity", "set name=PT-PROBA"],
      verifyCommands: ["/system identity print"],
      ...FAST,
    });
    expect(r2.salioDeConfig).toBe(false);
    expect(r2.abortado).toBe(true);
    expect(r2.motivoAborto).toBe("no_se_sale_de_config");
    expect(r2.intentosSalida).toBeGreaterThan(1);
    expect(r2.intentosSalida).toBeLessThanOrEqual(4);
    expect(r2.promptFinal).toBe("[admin@MikroTik] /system identity>");
    expect(r2.verificacion?.completa).toBe(false);
  });

  it("sin `salirDeConfig` declarado y con el lote dentro de un sub-modo: NO se dice que salió", async () => {

    const mockConsole = registra(hub, "s1", {
      prompt: "rtr>",
      commands: { "config": { promptFinal: "sw1 (config) #" } },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["config"],
      ...FAST,
    });

    expect(r.vendor).toBe("conservative");
    expect(mockConsole.commands).not.toContain("exit");
    expect(r.salioDeConfig).toBe(false);
    expect(r.intentosSalida).toBe(0);
    expect(r.modeFinal).toBe("config");
    expect(r.abortado).toBe(true);
    expect(r.motivoAborto).toBe("no_se_sale_de_config");
    expect(r.avisoSalida).toMatch(/sw1 \(config\) #/);
    expect(r.avisoSalida).toMatch(/prompt raíz/);
  });

  it("sin línea de salida y el lote NO cambia de menú: sigue sin haber nada que comprobar", async () => {

    const mockConsole = registra(hub, "s2", {
      prompt: "[admin@core-r1] >",
      typeDevice: "MIKROTIK",
      commands: { "/interface bridge add name=puente1": { responde: "0 R name=puente1" } },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["/interface bridge add name=puente1"],
      ...FAST,
    });

    expect(mockConsole.commands).not.toContain("exit");
    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(0);
    expect(r.avisoSalida).toBeNull();
    expect(r.abortado).toBe(false);
  });
});

describe("runConfigDetailed: nada se escribe a ciegas (puerta de prompt)", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  it("con el pre-flight desactivado, sin prompt la línea se OMITE y no se escribe", async () => {

    const mockConsole = registra(hub, "s1", { prompt: null, typeDevice: "CISCO" });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["hostname R1"],
      preflight: false,
      ...{ idleMs: 40, maxMs: 400 },
    });

    expect(mockConsole.escrito).toEqual([]);
    expect(r.pasos).toHaveLength(1);
    expect(r.pasos[0].status).toBe("omitido");
    expect(r.pasos[0].detail).toMatch(/no se escribió 'terminal length 0'/);
    expect(r.abortado).toBe(true);
    expect(r.motivoAborto).toBe("equipo_no_responde");
    expect(r.motivoAbortoTexto).toMatch(/read_terminal/);
  });
});

describe("runConfigDetailed: dryRun no escribe un byte", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  it("devuelve el plan completo y no escribe nada", async () => {
    const mockConsole = registra(hub, "s1", { prompt: "R1#", typeDevice: "CISCO", promptByDefecto: "R1(config)#" });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["interface GigabitEthernet0/1", "no shutdown"],
      guardar: true,
      verifyCommands: ["show ip interface brief"],
      dryRun: true,
      ...FAST,
    });

    expect(r.dryRun).toBe(true);
    expect(mockConsole.escrito).toEqual([]);
    expect(r.executed).toEqual([]);
    expect(r.pasos).toEqual([]);

    expect(r.salioDeConfig).toBe(true);
    expect(r.intentosSalida).toBe(0);
    expect(r.avisoSalida).toBeNull();
    expect(r.plan.lines.map((l) => l.command)).toEqual([
      "terminal length 0",
      "no ip domain-lookup",
      "configure terminal",
      "interface GigabitEthernet0/1",
      "no shutdown",
      "write memory",
      "exit",
      "show ip interface brief",
    ]);
    expect(r.plan.lines[0].reason).toMatch(/paginador/);
  });

  it("sin prompt el plan se devuelve igualmente y se dice que no se puede ejecutar", async () => {
    const mockConsole = registra(hub, "s1", { prompt: null, typeDevice: "CISCO" });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["hostname R1"],
      dryRun: true,
      ...FAST,
    });

    expect(mockConsole.escrito).toEqual([]);
    expect(r.motivoAborto).toBe("equipo_no_responde");
    expect(r.motivoAbortoTexto).toMatch(/no tiene un prompt listo/);

    expect(r.plan.lines.map((l) => l.command)).toContain("configure terminal");
  });
});

describe("runConfigDetailed: diálogos", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  it("Cisco: la confirmación PROPIA (Destination filename) se acepta con Enter", async () => {

    const hub2 = hub;
    const escrito: string[] = [];
    let preguntando = false;
    hub2.register({
      socketId: "s1",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R1",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data: string) => {
        escrito.push(String(data));
        const line = String(data).replace(/\r\n?|\n/g, "").trim();
        if (line === "write memory" && !preguntando) {
          preguntando = true;
          setTimeout(() => hub2.recordData("s1", "\r\nBuilding configuration...\r\n"), 5);
          setTimeout(
            () => hub2.recordData("s1", "\r\nDestination filename [startup-config]?"),
            10,
          );
          return;
        }

        if (preguntando && !line) {
          preguntando = false;
          setTimeout(() => hub2.recordData("s1", "\r\n[OK]\r\nR1#"), 5);
          return;
        }
        setTimeout(() => hub2.recordData("s1", "\r\nR1#"), 5);
      },
      isAlive: () => true,
    });
    hub2.recordData("s1", "\r\nR1(config)#");

    const r = await hub2.runConfigDetailed(hub2.get("s1")!, {
      commands: ["hostname R1"],
      guardar: true,
      ...FAST,
    });

    expect(r.abortado).toBe(false);
    expect(r.guardado).toBe(true);
    expect(r.dialogos).toHaveLength(1);
    expect(r.dialogos[0].tipo).toBe("confirmacion_propia");

    expect(r.dialogos[0].reply).toBe("");
    expect(r.dialogos[0].text).toMatch(/Destination filename \[startup-config\]/);
    expect(r.dialogos[0].reason).toMatch(/Enter/);

    expect(escrito.filter((t) => !t.trim())).toEqual(["\r"]);
    expect(escrito.some((t) => /^(yes|no|si|s)$/i.test(t.trim()))).toBe(false);
  });

  it("una pregunta al usuario ABORTA el lote y devuelve el diálogo literal", async () => {
    const mockConsole = registra(hub, "s1", {
      prompt: "R1#",
      typeDevice: "CISCO",
      promptByDefecto: "R1(config)#",
      commands: {
        reload: {
          responde: "System configuration has been modified. Reload? [confirm]",
          promptFinal: null,
        },
      },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["hostname R1", "reload"],
      ...FAST,
    });

    expect(r.abortado).toBe(true);
    expect(r.motivoAborto).toBe("confirmacion_destructiva");
    expect(r.dialogoPendiente?.tipo).toBe("destructiva");
    expect(r.dialogoPendiente?.text).toMatch(/Reload\? \[confirm\]/);

    expect(mockConsole.commands).toContain("hostname R1");
    expect(r.executed).toContain("hostname R1");

    expect(mockConsole.commands).not.toContain("yes");
    expect(mockConsole.commands).not.toContain("no");
  });

  it("[y/n] de Cisco también aborta y no se contesta", async () => {
    const mockConsole = registra(hub, "s1", {
      prompt: "R1#",
      typeDevice: "CISCO",
      promptByDefecto: "R1(config)#",
      commands: {
        "archive config": {
          responde: "Do you want to save changes? [yes/no]",
          promptFinal: null,
        },
      },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["archive config"],
      ...FAST,
    });

    expect(r.abortado).toBe(true);
    expect(r.motivoAborto).toBe("pregunta_al_usuario");
    expect(r.dialogoPendiente?.patron).toMatch(/yes\/no/i);
    expect(mockConsole.commands).toEqual(
      expect.not.arrayContaining(["yes", "no", "y", "n"]),
    );
  });

  it("un diálogo de arranque declarado se corta con el abortKey del perfil", async () => {
    const hub2 = hub;
    let sawDialog = false;
    hub2.register({
      socketId: "s2",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R2",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data: string) => {

        if (data === "\u001e") {
          setTimeout(() => hub2.recordData("s2", "\r\nR2#"), 5);
          return;
        }
        const line = data.replace(/\r\n?|\n/g, "").trim();
        if (line === "configure terminal" && !sawDialog) {
          sawDialog = true;
          setTimeout(
            () => hub2.recordData("s2", "\r\nContinue with configuration dialog? [y/n]"),
            5,
          );
          return;
        }
        setTimeout(() => hub2.recordData("s2", "\r\nR2#"), 5);
      },
      isAlive: () => true,
    });
    hub2.recordData("s2", "\r\nR2#");


    const r = await hub2.runConfigDetailed(hub2.get("s2")!, {
      commands: ["hostname R2"],
      ...FAST,
    });

    expect(r.abortado).toBe(true);
    expect(r.dialogoPendiente?.tipo).toBe("pregunta_al_usuario");
    expect(r.motivoAbortoTexto).toMatch(/USUARIO/);
  });

  it("un diálogo que llega TARDE (tras el silencio) también se detecta", async () => {

    const hub2 = hub;
    let preguntando = false;
    hub2.register({
      socketId: "s1",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R1",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data: string) => {
        const line = String(data).replace(/\r\n?|\n/g, "").trim();
        if (line === "archive config" && !preguntando) {
          preguntando = true;
          setTimeout(() => hub2.recordData("s1", "\r\nBuilding archive..."), 5);

          setTimeout(() => hub2.recordData("s1", "\r\nDo you want to save changes? [yes/no]"), 300);
          return;
        }
        setTimeout(() => hub2.recordData("s1", "\r\nR1#"), 5);
      },
      isAlive: () => true,
    });
    hub2.recordData("s1", "\r\nR1#");

    const r = await hub2.runConfigDetailed(hub2.get("s1")!, {
      commands: ["archive config"],
      ...{ idleMs: 40, maxMs: 3_000 },
    });


    expect(r.abortado).toBe(true);
    expect(r.motivoAborto).toBe("pregunta_al_usuario");
    expect(r.dialogoPendiente?.text).toMatch(/Do you want to save changes/);
    expect(r.pasos.some((p) => p.status === "dialogo")).toBe(true);
  });

  it("el diálogo queda diagnosticado: qué apareció, cómo se respondió y por qué", async () => {
    const mockConsole = registra(hub, "s1", {
      prompt: "R1#",
      typeDevice: "CISCO",
      promptByDefecto: "R1(config)#",
      commands: { "reload": { responde: "Reload? [confirm]", promptFinal: null } },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["reload"],
      ...FAST,
    });

    expect(r.dialogos).toHaveLength(1);
    expect(r.dialogos[0].fase).toBe("comando");
    expect(r.dialogos[0].reply).toBe("");
    expect(r.dialogos[0].reason).toMatch(/destructivo/);
    expect(r.dialogos[0].text).toMatch(/Reload\? \[confirm\]/);
  });
});

describe("runConfigDetailed: verificación y pre-flight", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  it("verifyCommands relee del equipo y la verificación es completa", async () => {
    const mockConsole = registra(hub, "s1", {
      prompt: "R1#",
      typeDevice: "CISCO",
      promptByDefecto: "R1(config)#",
      commands: {
        "show ip interface brief": {
          responde: "GigabitEthernet0/1 10.0.0.1  up  up",
          promptFinal: "R1#",
        },
      },
    });

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["interface GigabitEthernet0/1", "ip address 10.0.0.1 255.255.255.0"],
      verifyCommands: ["show ip interface brief"],
      ...FAST,
    });

    expect(r.verificacion?.completa).toBe(true);
    expect(r.verificacion?.resultados[0].output).toContain("10.0.0.1");
    expect(r.verificacion?.resultados[0].endReason).toBe("idle");

    const last = mockConsole.commands[mockConsole.commands.length - 1];
    expect(last).toBe("show ip interface brief");
  });

  it("si la verificación no se puede leer NO se da por aplicado", async () => {

    const hub2 = hub;
    hub2.register({
      socketId: "s1",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R1",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data: string) => {
        const line = String(data).replace(/\r\n?|\n/g, "").trim();
        if (line === "show run") return;
        setTimeout(
          () => hub2.recordData("s1", `\r\n${line === "configure terminal" ? "R1(config)#" : "R1#"}`),
          5,
        );
      },
      isAlive: () => true,
    });
    hub2.recordData("s1", "\r\nR1#");

    const r = await hub2.runConfigDetailed(hub2.get("s1")!, {
      commands: ["hostname R1"],
      verifyCommands: ["show run"],
      ...{ idleMs: 40, maxMs: 250 },
    });

    expect(r.verificacion?.completa).toBe(false);
    expect(r.verificacion?.reason).toMatch(/NO des por aplicado/);
    expect(r.abortado).toBe(true);
  });

  it("sin prompt no se escribe nada y el mensaje dice que puede estar apagado", async () => {
    const mockConsole = registra(hub, "s1", { prompt: null, typeDevice: "CISCO" });

    await expect(
      hub.runConfigDetailed(mockConsole.session, { commands: ["hostname R1"], ...FAST }),
    ).rejects.toThrow(/apagado/);
    expect(mockConsole.escrito).toEqual([]);
  });

  it("una consola que pide una tecla de arranque se despierta y se configura", async () => {

    const hub2 = hub;
    let despertado = false;
    hub2.register({
      socketId: "s3",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R3",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data: string) => {
        const text = String(data);
        if (!despertado && !text.trim()) {
          despertado = true;
          setTimeout(() => hub2.recordData("s3", "\r\nR3#"), 5);
          return;
        }
        const line = text.replace(/\r\n?|\n/g, "").trim();
        setTimeout(() => hub2.recordData("s3", `\r\n${line === "configure terminal" ? "R3(config)#" : "R3#"}`), 5);
      },
      isAlive: () => true,
    });
    hub2.recordData("s3", "\r\nPress RETURN to get started!");

    const r = await hub2.runConfigDetailed(hub2.get("s3")!, {
      commands: ["hostname R3"],
      ...{ idleMs: 40, maxMs: 2_000, preflight: { timeoutMs: 1_500 } },
    });

    expect(r.despertar?.intentos).toBeGreaterThanOrEqual(1);
    expect(r.abortado).toBe(false);
  });

  it("rechaza un lote absurdamente largo (protege el turno)", async () => {
    const mockConsole = registra(hub, "s1", { prompt: "R1#" });

    await expect(
      hub.runConfigDetailed(mockConsole.session, {
        commands: Array.from({ length: 61 }, (_, i) => `line ${i}`),
        ...FAST,
      }),
    ).rejects.toThrow(/60/);
    expect(mockConsole.escrito).toEqual([]);
  });
});

describe("runConfigDetailed: EOL del perfil (serie)", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  it("en SERIAL cada línea acaba en \\r (no \\r\\n, no \\n) y sin login", async () => {
    const mockConsole = registra(
      hub,
      "s1",
      { prompt: "R1#", promptByDefecto: "R1(config)#" },
      { protocol: "SERIAL", serialPort: "COM3", typeDevice: "CISCO" },
    );

    const r = await hub.runConfigDetailed(mockConsole.session, {
      commands: ["hostname SERIAL1"],
      ...FAST,
    });


    expect(r.vendor).toBe("cisco");
    expect(mockConsole.escrito).toHaveLength(5);
    for (const line of mockConsole.escrito) {
      expect(line.endsWith("\r")).toBe(true);
      expect(line.includes("\n")).toBe(false);
    }
  });

  it("el EOL del perfil es el que se usa (no el del transporte)", () => {

    for (const id of ["cisco", "huawei", "mikrotik", "aruba", "junos", "conservative"]) {
      expect(getVendorProfile(id).eol).toBe("\r");
    }
  });
});

describe("TerminalTools: configure_device", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  function userContext(overrides: Partial<RequestUser> = {}): RequestUser {
    return { id: "u1", username: "test", role: "ADMIN", ...overrides };
  }

  interface InvokableTool {
    name: string;
    invoke: (input: Record<string, unknown>) => Promise<string>;
  }

  function toolByName(name: string): InvokableTool {
    const encontrada = TERMINAL_TOOLS.find((candidate) => candidate.name === name);
    if (!encontrada) throw new Error(`Tool no encontrada: ${name}`);
    return encontrada as unknown as InvokableTool;
  }

  it("está registrada y es mutante de CLI sin autoApprove", () => {
    const policy = getToolPolicy("configure_device");
    expect(policy.access).toBe("mutating");
    expect(policy.kind).toBe("cli");
    expect(policy.commandsField).toBe("commands");

    expect(policy.autoApprove).toBeUndefined();
    expect(TERMINAL_TOOLS.some((t) => t.name === "configure_device")).toBe(true);
  });

  it("encendido y apagado también son mutantes (un apagado es destructivo)", () => {
    expect(getToolPolicy("setPower").access).toBe("mutating");
    expect(getToolPolicy("controlGns3NodePower").access).toBe("mutating");
    expect(getToolPolicy("setPower").autoApprove).toBeUndefined();
    expect(getToolPolicy("controlGns3NodePower").autoApprove).toBeUndefined();
  });

  it("un lote de configuración NO lo bloquea la protección de sesión del HITL", () => {

    const lote = ["interface GigabitEthernet0/1", "no shutdown", "description uplink"];
    const clasificacion = classifyCommands(lote, "R1(config)#", getVendorProfile("cisco"));
    expect(clasificacion.sessionCommands).toEqual([]);
    expect(clasificacion.level).toBe("config");

    expect(getVendorProfile("cisco").transiciones.salirDeConfig).toBe("exit");
  });

  it("sin consola devuelve TERMINAL_REQUIRED (no abre conexiones)", async () => {
    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("configure_device").invoke({ commands: ["hostname R1"] }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.code).toBe("TERMINAL_REQUIRED");
  });

  it("dryRun devuelve el plan y no escribe nada", async () => {
    const escritos: string[] = [];
    terminalSessionHub.register({
      socketId: "s1",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R1",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data) => {
        escritos.push(String(data));
      },
      isAlive: () => true,
    });
    terminalSessionHub.recordData("s1", "\r\nR1#");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("configure_device").invoke({
          commands: ["interface GigabitEthernet0/1", "no shutdown"],
          save: true,
          dryRun: true,
        }),
      ),
    );

    expect(escritos).toEqual([]);
    expect(output.success).toBe(true);
    expect(output.code).toBe("PLAN_ONLY");
    expect(output.escrito).toBe(false);
    expect(output.vendor).toBe("cisco");
    expect(output.plan.lines.map((l: { command: string }) => l.command)).toEqual([
      "terminal length 0",
      "no ip domain-lookup",
      "configure terminal",
      "interface GigabitEthernet0/1",
      "no shutdown",
      "write memory",
      "exit",
    ]);
    expect(output.pasos).toEqual([]);
  });

  it("sin prompt devuelve TERMINAL_NOT_RESPONDING y no escribe", async () => {
    const escritos: string[] = [];
    terminalSessionHub.register({
      socketId: "s1",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R1",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data) => {
        escritos.push(String(data));
      },
      isAlive: () => true,
    });

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("configure_device").invoke({ commands: ["hostname R1"], timeoutMs: 300 }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.code).toBe("TERMINAL_NOT_RESPONDING");
    expect(output.message).toMatch(/apagado/i);
    expect(escritos).toEqual([]);
  });

  it("un diálogo al usuario devuelve DIALOGO_PENDIENTE con el texto literal", async () => {
    const terminalSessionHubRef = terminalSessionHub;
    let asked = false;
    terminalSessionHubRef.register({
      socketId: "s1",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R1",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data) => {
        const line = String(data).replace(/\r\n?|\n/g, "").trim();
        if (line === "reload" && !asked) {
          asked = true;
          setTimeout(() => terminalSessionHubRef.recordData("s1", "\r\nReload? [confirm]"), 5);
          return;
        }
        setTimeout(() => terminalSessionHubRef.recordData("s1", "\r\nR1(config)#"), 5);
      },
      isAlive: () => true,
    });
    terminalSessionHubRef.recordData("s1", "\r\nR1#");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("configure_device").invoke({
          commands: ["reload"],
          timeoutMs: 800,
        }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.code).toBe("DIALOGO_PENDIENTE");
    expect(output.dialogoPendiente.tipo).toBe("destructiva");
    expect(output.dialogoPendiente.text).toMatch(/Reload\? \[confirm\]/);
    expect(output.abortado).toBe(true);
  });

  it("la verificación incompleta devuelve NO_VERIFICADO con esas palabras", async () => {
    terminalSessionHub.register({
      socketId: "s1",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "R1",
      fingerprint: null,
      typeDevice: "CISCO",
      write: (data) => {
        const line = String(data).replace(/\r\n?|\n/g, "").trim();
        if (line === "show run") {

          setTimeout(() => terminalSessionHub.recordData("s1", "\r\nBuilding configuration...\r\n"), 5);
          return;
        }
        setTimeout(() => terminalSessionHub.recordData("s1", "\r\nR1(config)#"), 5);
      },
      isAlive: () => true,
    });
    terminalSessionHub.recordData("s1", "\r\nR1#");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("configure_device").invoke({
          commands: ["hostname R1"],
          verifyCommands: ["show run"],
          timeoutMs: 250,
        }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.code).toBe("NO_VERIFICADO");
    expect(output.verificacion.completa).toBe(false);
    expect(output.message).toMatch(/NO VERIFICADO/);
  });
});
