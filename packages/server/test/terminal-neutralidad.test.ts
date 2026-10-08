

import { beforeEach, describe, expect, it } from "vitest";
import {
  clasificarEsperaDeEntrada,
  detectarPaginador,
  INVARIANTE_ARRANQUE_RE,
  INVITACION_RESPUESTA_RE,
  limpiarMarcasPaginador,
  PENDING_PROMPT_RE,
  pendingInputReason,
  recortarPorEco,
} from "@/sockets/terminalIO";
import {
  TerminalSessionHub,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";
import {
  detectVendorIdFromPrompt,
  resolveVendorId,
} from "@/agent/security/VendorProfile";






function echoRepintado(prompt: string, command: string, separador = " "): string {
  let acumulado = "";
  let output = "";
  for (const ch of command) {
    acumulado += ch;
    output += `\r\x1b[36m${prompt}\x1b[m${separador}\x1b[31m${acumulado}\x1b[K\r`;
  }
  return `${output}\r\n`;
}


interface EchoOfMarker {
  etiqueta: string;
  prompt: string;
  command: string;
  output: string;
  separador?: string;
}

const ECOS: readonly EchoOfMarker[] = [
  {
    etiqueta: "Cisco IOS/XE/NX-OS",
    prompt: "R1#",
    command: "show version",
    output: "Cisco IOS Software, Version 15.2(4)M7",
    separador: "",
  },
  {
    etiqueta: "Huawei VRP",
    prompt: "<Huawei>",
    command: "display version",
    output: "VRP (R) software, Version 8.19 (R1)",
    separador: "",
  },
  {
    etiqueta: "MikroTik RouterOS",
    prompt: "[admin@core-r1] >",
    command: "/system resource print",
    output: "uptime: 3d4h5m6s",
  },
  {
    etiqueta: "Juniper JunOS",
    prompt: "user@vsrx>",
    command: "show version",
    output: "Hostname: vsrx",
  },
  {
    etiqueta: "ArubaOS",
    prompt: "(host) #",
    command: "show running-config",
    output: "hostname host",
    separador: "",
  },
  {
    etiqueta: "VyOS",
    prompt: "vyos@vyos:~$",
    command: "show version log",
    output: "Uptime: 3 days",
  },
  {
    etiqueta: "Fortinet",
    prompt: "FGT #",
    command: "get system status",
    output: "Serial-Number: FGVMEV0000000000",
  },
  {
    etiqueta: "genérico",
    prompt: "rtr>",
    command: "show system",
    output: "Sistema operativo: v1.0",
    separador: "",
  },
];

describe("recortarPorEco: el ancla se encuentra con CUALQUIER forma de eco", () => {
  for (const marker of ECOS) {
    it(`${marker.etiqueta} ("${marker.prompt}"): el eco repintado se recorta y solo queda la salida`, () => {
      const echo = echoRepintado(marker.prompt, marker.command, marker.separador ?? " ");
      const capturado = `${echo}${marker.output}\r\n${marker.prompt} `;

      const cut = recortarPorEco(capturado, marker.command);

      expect(cut.recortado).toBe(true);
      expect(cut.reason).toBe("eco");

      expect(cut.text.startsWith(marker.output)).toBe(true);

      expect(cut.text.split(marker.prompt).length - 1).toBeLessThanOrEqual(1);

      expect(capturado.length).toBeGreaterThan(cut.text.length * 2);
    });

    it(`${marker.etiqueta}: el eco partido en dos líneas (consola estrecha) también se reconoce`, () => {

      const capturado =
        `${marker.prompt} ${marker.command.split(" ")[0]}\r\n` +
        `${marker.command.split(" ").slice(1).join(" ")}\r\n` +
        `${marker.output}\r\n${marker.prompt}`;

      const cut = recortarPorEco(capturado, marker.command);

      expect(cut.recortado).toBe(true);
      expect(cut.text).toContain(marker.output);
    });
  }

  it("NO se corta de más si el comando aparece al final de la propia salida", () => {

    const capturado =
      "R1#show ip interface brief\r\n" +
      "GigabitEthernet0/0     10.0.0.1    up    up\r\n" +
      " description show ip interface brief\r\n" +
      "R1#";

    const cut = recortarPorEco(capturado, "show ip interface brief");

    expect(cut.recortado).toBe(true);
    expect(cut.reason).toBe("eco");
    expect(cut.text).toContain("GigabitEthernet0/0");
    expect(cut.text).toContain("10.0.0.1");
    expect(cut.text).toContain("description show ip interface brief");
  });

  it("sin eco y con un ancla que solo deja el prompt: no recorta y lo dice", () => {

    const capturado = "R1#show version\r\nR1#";

    const cut = recortarPorEco(capturado, "show version");

    expect(cut.recortado).toBe(false);
    expect(cut.text).toBe(capturado);
    expect(["eco_sin_salida", "eco_solo_prompt"]).toContain(cut.reason);
  });

  it("el límite de palabra no depende del prompt del fabricante", () => {

    for (const prompt of ["R1#", "<Huawei>", "user@vsrx>", "(host) #", "[admin@core-r1] >"]) {
      const capturado = `${prompt}show version\r\nVersion 6.49.13\r\n${prompt}`;
      const cut = recortarPorEco(capturado, "show version");
      expect(cut.recortado, `ancla pegada a "${prompt}"`).toBe(true);
      expect(cut.text.startsWith("Version 6.49.13")).toBe(true);
    }
  });

  it("el corte cae detrás del ancla aunque el equipo meta ANSI justo detrás", () => {

    const capturado =
      "R1# \x1b[1mshow\x1b[m \x1b[1mversion\x1b[K\r\n" +
      "Cisco IOS Software, Version 15.2\r\nR1#";

    const cut = recortarPorEco(capturado, "show version");

    expect(cut.recortado).toBe(true);
    expect(cut.text).toBe("Cisco IOS Software, Version 15.2\r\nR1#");
  });

  it("un espacio antes del salto de línea no invalida el ancla", () => {

    const capturado = "R1# show version \r\nCisco IOS 15.2\r\nR1#";

    const cut = recortarPorEco(capturado, "show version");

    expect(cut.recortado).toBe(true);
    expect(cut.text).toBe("Cisco IOS 15.2\r\nR1#");
  });

  it("una respuesta de UNA línea no se confunde con un prompt", () => {

    const echo = echoRepintado("[admin@core-r1] >", "show version");
    const capturado = `${echo}bad command name show (line 1 column 1)`;

    const cut = recortarPorEco(capturado, "show version");

    expect(cut.recortado).toBe(true);
    expect(cut.text).toBe("bad command name show (line 1 column 1)");
  });
});



describe("INVARIANTE_ARRANQUE_RE: cada familia pide su Return con su frase", () => {
  it("reconoce los invariantes de arranque reales de cada fabricante", () => {
    const arranque: readonly [string, string][] = [

      ["Cisco IOS", "Press RETURN to get started!"],
      ["Cisco IOS", "User Access Verification"],

      ["Huawei VRP", "User interface con0 is available"],
      ["Huawei VRP", "Please Press ENTER."],
      ["Huawei VRP", "Please press Enter to activate this console"],

      ["genérico", "Press any key to continue"],
      ["genérico", "Hit Enter to continue"],
      ["genérico", "Please wait for the system to initialize"],
    ];
    for (const [marker, phrase] of arranque) {
      expect(clasificarEsperaDeEntrada(phrase).invariante, `${marker}: ${phrase}`).toBe(true);
    }
  });

  it("una PREGUNTA nunca es un invariante (ni aunque pida Enter)", () => {
    for (const phrase of [
      "Would you like to enter the initial configuration dialog? [yes/no]:",
      "The system will reboot. Continue? [Y/N]:",
      "Reset configuration and reboot? [y/n]",
      "Reboot the system ? [yes,no] (no)",
      "Do you want to save the configuration? (y/n) [y/n]",
      "Are you sure you want to reload? [y/N]",
      "Enter Password: ",
      "Username: ",
      "login: ",
      "Proceed? [confirm]",
    ]) {
      const status = clasificarEsperaDeEntrada(phrase);
      expect(status.question, `pregunta no detectada en: ${phrase}`).not.toBeNull();

      if (!/press|hit/i.test(phrase)) {
        expect(status.invariante, `falso invariante en: ${phrase}`).toBe(false);
      }
    }
  });

  it("MikroTik no pide nada al arrancar: sin invariante y sin pregunta", () => {

    for (const phrase of [
      "  MikroTik RouterOS 6.49.13  \r\n  Copyright 1999-2023 MikroTik",
      "JUNOS 20.4R3-S4.9 built 2023-02-01",
    ]) {
      const status = clasificarEsperaDeEntrada(phrase);
      expect(status.invariante, phrase).toBe(false);
      expect(status.question, phrase).toBeNull();
      expect(status.hayTexto, phrase).toBe(true);
    }
  });

  it("la columna de `PENDING_PROMPT_RE` reconoce la pregunta de Junos con coma", () => {

    expect(pendingInputReason("Reboot the system ? [yes,no] (no) ")).toBeTruthy();
    expect(pendingInputReason("The system will reboot. Continue? [Y/N]:")).toBeTruthy();
    expect(pendingInputReason("Do you want to continue? (y/n)")).toBeTruthy();
  });
});



describe("detectarPaginador: la marca real de cada fabricante", () => {
  it("cubre la marca verificada de cada familia", () => {
    const markers: readonly [string, string, string][] = [

      ["mas-more", "linea 1\r\n--More--", "Cisco IOS/XE/NX-OS, FortiOS, ArubaOS"],
      ["mas-more", "linea 1\r\n---- More ----", "Huawei VRP"],
      ["mas-more-paren", "linea 1\r\n---(more)---", "Juniper JunOS"],
      ["mas-more", "linea 1\r\n-- more --", "variante espaciada"],
      ["guion-more", "linea 1\r\n-More-", "familias de un guion"],
      ["q-quit", "linea 1\r\n[Q|quit]", "MikroTik RouterOS / ArubaOS"],
      ["chino", "配置行\r\n按Enter继续", "clientes en chino"],
      ["end", "show tech-support completo (END)", "more(1) al final"],
    ];
    for (const [variant, text, familia] of markers) {
      const d = detectarPaginador(text);
      expect(d.activo, `${familia}: ${text}`).toBe(true);
      expect(d.variant, `${familia}: ${text}`).toBe(variant);
    }
  });

  it("los huecos documentados NO se pagan (y son huecos, no inventos)", () => {

    const vyos = detectarPaginador("linea 1\r\nlinea 2\r\n:");
    expect(vyos.activo).toBe(false);


    const routeros = detectarPaginador("linea 1\r\n-- [Q quit|D dump|C-z pause]");
    expect(routeros.activo).toBe(false);
  });

  it("nunca confunde una frase normal con un paginador", () => {
    for (const text of [
      "There are 3 more interfaces in the system",
      "Press RETURN to get started!",
      "Please configure the login password (8-16)",
      "interface GigabitEthernet0/0",
    ]) {
      expect(detectarPaginador(text).activo, text).toBe(false);
    }
  });

  it("limpiar quita la marca (incluida la de Junos) y no toca texto normal", () => {
    const mas = "mas lineas";
    expect(limpiarMarcasPaginador(`datos---(more)---\r\n${mas}`)).toBe(
      `datos\r\n${mas}`,
    );
    expect(limpiarMarcasPaginador(`datos--More--\r\n${mas}`)).toBe(`datos\r\n${mas}`);
    expect(limpiarMarcasPaginador(`datos[Q|quit]\r\n${mas}`)).toBe(`datos\r\n${mas}`);
    expect(limpiarMarcasPaginador("There are 3 more interfaces")).toBe(
      "There are 3 more interfaces",
    );
  });
});



describe("Hub: el prompt reemitido se quita con cualquier marca", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });



  function mockconsoleOfMarker(marker: EchoOfMarker): void {
    hub.register({
      socketId: "s1",
      userId: "u1",
      providerId: "p1",
      protocol: "TELNET",
      deviceName: "equipo",
      fingerprint: null,
      write: (data) => {

        const text = String(data).replace(/\r$/, "");
        setTimeout(
          () =>
            hub.recordData(
              "s1",
              echoRepintado(marker.prompt, text, marker.separador ?? " ") +
                `${marker.output}\r\n${marker.prompt}`,
            ),
          5,
        );
      },
      isAlive: () => true,
    });
    hub.recordData("s1", `\r\n${marker.prompt} `);
  }

  for (const marker of ECOS) {
    it(`${marker.etiqueta}: la salida devuelta NO acaba en "${marker.prompt}"`, async () => {
      mockconsoleOfMarker(marker);

      const result = await hub.sendCommandDetailed(hub.get("s1")!, marker.command, {
        idleMs: 60,
        maxMs: 2_000,
      });

      expect(result.output.trim()).toBe(marker.output);
      expect(result.output).not.toContain(marker.prompt);
      expect(result.recortado).toBe(true);
      expect(result.motivoCorte).toBe("eco");
    });
  }

  it("sin quitarlo se perdería texto: el prompt es ruido, la salida es el dato", async () => {

    mockconsoleOfMarker(ECOS[2]);
    const result = await hub.sendCommandDetailed(hub.get("s1")!, ECOS[2].command, {
      idleMs: 60,
      maxMs: 2_000,
    });
    expect(result.output.trim().length).toBeLessThan(40);
  });
});



describe("vendor por prompt: lo concluyente se resuelve, lo demás al conservador", () => {
  it("cada prompt concluyente da su vendor (declarado o por prompt)", () => {
    const casos: readonly [string, string][] = [
      ["<Huawei>", "huawei"],
      ["[R1-GigabitEthernet0/0]", "huawei"],
      ["[admin@core-r1] >", "mikrotik"],
      ["[admin@core-r1] /interface", "mikrotik"],
      ["(host) #", "aruba"],
      ["(host) (config) #", "aruba"],
      ["[edit interfaces ge-0/0/0]", "junos"],

      ["user@vsrx>", "junos"],
      ["user@vsrx#", "junos"],
    ];
    for (const [prompt, esperado] of casos) {
      expect(detectVendorIdFromPrompt(prompt), prompt).toBe(esperado);
      expect(resolveVendorId({ typeDevice: "GENERIC", prompt }), prompt).toBe(esperado);
    }
  });

  it("los prompts que NO identifican a nadie caen al conservador (a propósito)", () => {

    for (const prompt of ["R1#", "FGT #", "switch#", "vyos@vyos:~$", "root@vyos:~#", "rtr>"]) {
      expect(detectVendorIdFromPrompt(prompt), prompt).toBeNull();
      expect(resolveVendorId({ typeDevice: "GENERIC", prompt }), prompt).toBe("conservative");
      expect(resolveVendorId({ prompt }), prompt).toBe("conservative");
    }

    expect(resolveVendorId({ typeDevice: "CISCO", prompt: "R1#" })).toBe("cisco");
    expect(resolveVendorId({ typeDevice: "HUAWEI", prompt: "<Huawei>" })).toBe("huawei");
    expect(resolveVendorId({ typeDevice: "ARUBA", prompt: "(host) #" })).toBe("aruba");
    expect(resolveVendorId({ typeDevice: "MIKROTIK", prompt: "[admin@core-r1] >" })).toBe(
      "mikrotik",
    );
  });

  it("no se cuela ningún vendor inexistente en el enum TypeDevice", () => {

    expect(resolveVendorId({ typeDevice: "JUNOS", prompt: "user@vsrx>" })).toBe("junos");
    expect(resolveVendorId({ typeDevice: "JUNOS", prompt: null })).toBe("conservative");
    expect(resolveVendorId({ typeDevice: "FORTINET", prompt: "FGT #" })).toBe("conservative");
  });
});



describe("metaprueba: las expresiones no están atadas a una marca", () => {
  
  const NAMES_OF_MARKER =
    /cisco|huawei|hua\b|mikrotik|routeros|aruba|junos|juniper|vyos|fortinet|fortios|palo\s*alto|critical\s*path|extrem|\bnxos\b|\bxr\b/i;

  it("las expresiones de espera y de paginador no citan a ningún fabricante", () => {
    const expresiones: readonly [string, RegExp][] = [
      ["INVARIANTE_ARRANQUE_RE", INVARIANTE_ARRANQUE_RE],
      ["INVITACION_RESPUESTA_RE", INVITACION_RESPUESTA_RE],
      ["PENDING_PROMPT_RE", PENDING_PROMPT_RE],
    ];
    for (const [name, re] of expresiones) {
      expect(re.source, `${name} cita a un fabricante`).not.toMatch(NAMES_OF_MARKER);
    }
  });

  it("la invitación a responder no menciona marcas de paginador", () => {

    expect(INVITACION_RESPUESTA_RE.source).not.toMatch(/more/i);
    expect(INVITACION_RESPUESTA_RE.source).not.toMatch(/quit/i);

    expect(INVITACION_RESPUESTA_RE.source).not.toMatch(/\\\[Q/);
    expect(INVITACION_RESPUESTA_RE.source).not.toMatch(/end/i);
    expect(INVITACION_RESPUESTA_RE.source).not.toMatch(/继续/);
  });

  it("el invariante de arranque no incluye las formas de confirmación", () => {

    expect(INVARIANTE_ARRANQUE_RE.source).not.toMatch(/y\\?\/n|yes\\?\/no|confirm/i);
    expect(INVARIANTE_ARRANQUE_RE.source).not.toMatch(/password|login|username/i);
  });

  it("cada invariante conocido sigue funcionando (el inventario no se vació)", () => {
    for (const phrase of [
      "Press RETURN to get started!",
      "User Access Verification",
      "System Bootstrap",
      "Please wait",
      "autoconfiguration",
    ]) {
      expect(INVARIANTE_ARRANQUE_RE.test(phrase), phrase).toBe(true);
    }
  });

  it("cada invitación a responder conocida sigue funcionando", () => {
    for (const shape of [
      "[yes/no]",
      "[y/n]",
      "(y/n)",
      "[confirm]",
      "[yes,no]",
      "Username:",
      "login:",
      "password:",
      "Continue?",
      "Are you sure",
    ]) {
      expect(INVITACION_RESPUESTA_RE.test(shape), shape).toBe(true);
    }
  });
});
