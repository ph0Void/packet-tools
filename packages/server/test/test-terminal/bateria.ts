
import {
  PAGINADOR_MAX_PAGINAS,
  snapshotPromptSatisfies,
  terminalSessionHub,
  type TerminalCommandResult,
} from "@/sockets/TerminalSessionHub";
import { getVendorProfile } from "@/agent/security/VendorProfile";
import { TERMINAL_TOOLS } from "@/agent/tools/TerminalTools";
import {
  createMockConsoleFake,
  waitConnections,
  type ConnectionMockConsole,
  type MockConsoleFake,
  type EscenaMockConsole,
  type VariantPaginator,
} from "./servidorFalso";
import {
  assert,
  comoAdmin,
  connectMockConsole,
  waitPrompt,
  skip,
  type AdminSuite,
  type MockConsoleConnected,
  type PayloadConnection,
} from "./harness";






export type Transport = "TELNET" | "SSH" | "SERIAL";


export interface RequestedMockConsole {
  
  escena: EscenaMockConsole;
  
  typeDevice?: string | null;
  
  prompt?: string | null;
  
  name?: string;
}


export interface MockConsoleAbierta {
  sessionId: string;
  session: MockConsoleAbiertaSession;
  
  mock: ConnectionMockConsole | null;
  cerrar(): Promise<void>;
}


type MockConsoleAbiertaSession = MockConsoleConnected["session"];


export type ConnectMockConsole = (requested: RequestedMockConsole) => Promise<MockConsoleAbierta>;


export interface OpcionesSuite {
  
  protocolo: Transport;
  
  host?: string;
  
  port?: number;
  
  serialPort?: string;
  
  baudRate?: number;
  
  kindDevice?: string | null;
  
  username?: string;
  password?: string;
  
  connect: ConnectMockConsole;
  
  etiqueta: string;
  
  mock: boolean;
  
  command?: string;
  
  prompt?: string;
  
  name?: string;
}


const DIAGNOSTICO = { idleMs: 500, maxMs: 15_000 };


interface ToolInvocable {
  name: string;
  invoke: (input: Record<string, unknown>) => Promise<string>;
}


function toolByName(name: string): ToolInvocable {
  const encontrada = TERMINAL_TOOLS.find((t) => t.name === name);
  if (!encontrada) throw new Error(`Tool de terminal inexistente: ${name}`);
  return encontrada as unknown as ToolInvocable;
}


function sePuede(opciones: OpcionesSuite): boolean {
  return opciones.mock;
}


const REASON_MOCK =
  "depende de controlar la consola (servidor falso): un equipo real no se puede convencer de que page, de que se cuelgue ni de que no de prompt";


function skipSimulados(opciones: OpcionesSuite, casos: string): void {
  for (const caso of casos.split("|")) {
    skip(`omitido en ${opciones.etiqueta}: ${caso}`, REASON_MOCK);
  }
}



async function caseEnv(url: string, admin: AdminSuite): Promise<void> {
  const vida = await fetch(`${url}/api/health`).catch(() => null);
  assert(
    "entorno: el backend real responde en /api/health",
    vida !== null && vida.ok,
    `HTTP ${vida?.status} en ${url}/api/health`,
    `el backend no respondió en ${url}/api/health: ${vida ? `HTTP ${vida.status}` : "sin respuesta"}`,
  );
  assert(
    "entorno: el login real devolvió JWT y el usuario es ADMIN",
    Boolean(admin.token) && admin.user.role === "ADMIN",
    `ADMIN=${admin.username} (${admin.user.id})`,
    `login sin JWT o sin ADMIN: role=${admin.user.role} token=${Boolean(admin.token)}`,
  );
  assert(
    "entorno: el hub de terminales arranca limpio",
    terminalSessionHub.listSessions(admin.user.id).length === 0,
    "hub operativo y sin sesiones heredadas de otra ejecución",
    `el hub arranca con ${terminalSessionHub.listSessions(admin.user.id).length} sesiones: ` +
      "quedó alguna de una ejecución anterior",
  );
}




const PAGES = 4;

const PREFIX = "cfg";

const TEXT_LAST_PAGE = `${PREFIX}-FINAL-p${PAGES}`;

async function casePaginator(admin: AdminSuite, url: string, opciones: OpcionesSuite) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "paginador (salida completa)");
    return;
  }
  const scenario = await opciones.connect({
    escena: {
      prompt: "R1#",
      commands: { "show running-config": { pages: PAGES, prefix: PREFIX } },
    },
    typeDevice: opciones.kindDevice ?? "CISCO",
    prompt: "R1#",
    name: "paginador",
  });
  try {
    const team = scenario.mock;

    const r = JSON.parse(
      await toolByName("send_command").invoke({
        command: "show running-config",
        waitForPromptMs: 15_000,
      }),
    ) as Record<string, unknown>;
    const output = String(r.output ?? "");

    assert(
      "paginador: la salida llega COMPLETA (está la última página)",
      output.includes(TEXT_LAST_PAGE),
      `contiene "${TEXT_LAST_PAGE}" (${output.length} chars)`,
      `la salida NO contiene "${TEXT_LAST_PAGE}": el cliente se quedó antes del final ` +
        `y devolvió éxito. final=${JSON.stringify(output.slice(-240))}`,
    );
    assert(
      "paginador: el hub pagó las páginas del equipo",
      r.paged === true && Number(r.pages) > 0,
      `paged=${r.paged} pages=${r.pages} pagerVariant=${r.pagerVariant}`,
      `paged=${r.paged} pages=${r.pages}: el hub no pagó nada y la salida quedó a medias`,
    );

    assert(
      "paginador: se paginaron las páginas exactas",
      Number(r.pages) === PAGES - 1,
      `${r.pages} páginas pagadas de ${PAGES} emitidos`,
      `${r.pages} páginas pagadas (esperadas ${PAGES - 1}): el hub pagó de más o de menos`,
    );
    assert(
      "paginador: no se agotó el tiempo",
      r.timedOut === false && r.endReason === "idle",
      `endReason=${r.endReason} timedOut=${r.timedOut} elapsedMs=${r.elapsedMs}`,
      `endReason=${r.endReason} timedOut=${r.timedOut}: la captura no terminó limpiamente`,
    );
    assert(
      "paginador: no quedan restos de la marca en la salida",
      !/--\s*more\s*--/i.test(output),
      "sin restos de --More-- en el texto que recibe el agente",
      `quedan restos del paginador: ${JSON.stringify(output.slice(-200))}`,
    );
    assert(
      "paginador: el equipo recibió una tecla por página y solo el comando",
      team?.teclasPaginator === PAGES - 1 &&
        team?.lines.join("|") === "show running-config",
      `${team?.teclasPaginator} teclas de paginador, escrito=${JSON.stringify(team?.lines)}`,
      `el equipo vio ${team?.teclasPaginator} teclas y ${JSON.stringify(team?.lines)} ` +
        `(esperadas ${PAGES - 1} teclas y solo el comando)`,
    );
  } finally {
    await scenario.cerrar();
  }
}




const TECLAS_MAX_COLGADO = 3;

async function casePaginatorColgado(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "paginador colgado");
    return;
  }
  const scenario = await opciones.connect({
    escena: {
      prompt: "R1#",

      paginatorColgado: true,
      commands: { "show tech-support": { pages: 3, prefix: "ts" } },
    },
    typeDevice: opciones.kindDevice ?? "CISCO",
    prompt: "R1#",
    name: "paginador-colgado",
  });
  const start = Date.now();
  try {
    const r = await terminalSessionHub.sendCommandDetailed(
      scenario.session,
      "show tech-support",
      DIAGNOSTICO,
    );
    const teclas = scenario.mock?.teclasPaginator ?? 0;

    assert(
      "paginador colgado: la llamada vuelve con un motivo coherente",
      r.endReason === "pending" && r.paged === true && r.pendingInput !== null,
      `endReason=${r.endReason} paged=${r.paged} pendingInput=${JSON.stringify(r.pendingInput)} ` +
        `elapsedMs=${r.elapsedMs}`,
      `endReason=${r.endReason} paged=${r.paged} pendingInput=${JSON.stringify(r.pendingInput)}: ` +
        'se esperaba "pending" con la marca del paginador viva',
    );
    assert(
      "paginador colgado: no se colgó ni agotó el plazo",
      r.timedOut === false && r.elapsedMs < DIAGNOSTICO.maxMs,
      `tardó ${Date.now() - start} ms con un presupuesto de ${DIAGNOSTICO.maxMs} ms`,
      `tardó ${Date.now() - start} ms (presupuesto ${DIAGNOSTICO.maxMs} ms): el cliente se quedó colgado`,
    );
    assert(
      "paginador colgado: las teclas enviadas están acotadas",
      teclas >= 1 && teclas <= TECLAS_MAX_COLGADO && teclas <= PAGINADOR_MAX_PAGINAS,
      `el equipo recibió ${teclas} tecla(s) de paginador y el cliente dejó de insistir`,
      `el equipo recibió ${teclas} tecla(s) (tope ${TECLAS_MAX_COLGADO}): el cliente insiste ` +
        "contra un paginador muerto en vez de darse por vencido",
    );
    assert(
      "paginador colgado: se entrega lo leído, sin inventarse el final",
      r.output.includes("ts-p1-l1"),
      "la salida parcial paginada se devuelve tal cual (el agente puede avisar)",
      `la salida no contiene ni la primera página: ${JSON.stringify(r.output.slice(-200))}`,
    );
  } finally {
    await scenario.cerrar();
  }
}



interface VariantCase {
  marker: VariantPaginator;
  
  total: number;
}


const VARIANTS: readonly VariantCase[] = [
  { marker: "--More--", total: 2 },
  { marker: "---- More ----", total: 2 },
  { marker: "---(more)---", total: 2 },
  { marker: "-More-", total: 2 },
  { marker: "[Q|quit]", total: 2 },
  { marker: "按Enter继续", total: 2 },
];

async function caseVariantsPaginator(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "variantes de paginador");
    return;
  }
  for (const { marker, total } of VARIANTS) {
    const pagos = total - 1;
    const scenario = await opciones.connect({
      escena: {
        prompt: "R1#",
        commands: { "show version": { pages: total, prefix: "v", variant: marker } },
      },
      typeDevice: opciones.kindDevice ?? "CISCO",
      prompt: "R1#",
      name: `paginador-${marker}`,
    });
    try {
      const r = await terminalSessionHub.sendCommandDetailed(
        scenario.session,
        "show version",
        DIAGNOSTICO,
      );
      const teclas = scenario.mock?.teclasPaginator ?? 0;
      assert(
        `paginador "${marker}": se paga y la salida llega entera`,
        r.paged === true &&
          r.pages === pagos &&
          r.output.includes(`v-FINAL-p${total}`) &&
          r.endReason === "idle",
        `paged=${r.paged} pages=${r.pages} variante=${r.pagerVariant} endReason=${r.endReason} ` +
          `y contiene "v-FINAL-p${total}"`,
        `paged=${r.paged} pages=${r.pages} (esperados ${pagos}) variante=${r.pagerVariant} ` +
          `endReason=${r.endReason} llegaAlFinal=${r.output.includes(`v-FINAL-p${total}`)}: ` +
          `la marca "${marker}" no se pagó bien`,
      );
      assert(
        `paginador "${marker}": el equipo recibió ${pagos} tecla(s)`,
        teclas === pagos,
        `${teclas} tecla(s) de paginador recibidas`,
        `${teclas} tecla(s) recibidas (esperadas ${pagos})`,
      );
    } finally {
      await scenario.cerrar();
    }
  }
}



async function casePromptParcial(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(
      opciones,
      "wait_for_prompt por coincidencia parcial|hasta donde esperar prompt",
    );
    return;
  }

  const scenario = await opciones.connect({
    escena: { prompt: "core-r1(config)#" },
    typeDevice: "CISCO",
    prompt: "core-r1(config)#",
    name: "prompt-parcial",
  });
  try {
    const inicial = terminalSessionHub.getSnapshot(scenario.sessionId);
    assert(
      "prompt parcial: la consola está en core-r1(config)#",
      inicial?.prompt === "core-r1(config)#",
      `prompt detectado="${inicial?.prompt}"`,
      `prompt detectado=${JSON.stringify(inicial?.prompt)}`,
    );


    const r = JSON.parse(
      await toolByName("wait_for_prompt").invoke({ expected: "R1", timeoutMs: 600 }),
    ) as Record<string, unknown>;
    assert(
      'prompt parcial: pedir "R1" en core-r1(config)# da timeout',
      r.timedOut === true,
      `timedOut=${r.timedOut} con prompt real "${r.prompt}"`,
      `timedOut=${r.timedOut}: "R1" se dio por bueno dentro de "core-r1(config)#" ` +
        "(falso positivo por subcadena)",
    );
    assert(
      "prompt parcial: el timeout dice qué prompt había de verdad",
      typeof r.promptWaitMessage === "string" && r.promptWaitMessage.includes("core-r1"),
      "promptWaitMessage incluye el prompt real",
      `promptWaitMessage no menciona el prompt real: ${JSON.stringify(r.promptWaitMessage)}`,
    );


    const full = await terminalSessionHub.waitForPrompt(scenario.session, {
      expected: "core-r1(config)#",
      timeoutMs: 600,
    });
    assert(
      'prompt parcial: el prompt completo "core-r1(config)#" sí se reconoce',
      snapshotPromptSatisfies(full, "core-r1(config)#") === true,
      `prompt=${full.prompt} vendor=${full.vendor}`,
      `el prompt completo no se reconoció: prompt=${full.prompt} ` +
        `promptWaitMessage=${full.promptWaitMessage}`,
    );
    assert(
      'prompt parcial: "R1" tampoco casa con el snapshot (mismo criterio que la tool)',
      snapshotPromptSatisfies(full, "R1") === false,
      'snapshotPromptSatisfies(snapshot, "R1") === false',
      'snapshotPromptSatisfies(snapshot, "R1") devolvió true: sigue el falso positivo',
    );
    assert(
      "prompt parcial: core-r1(config)# Sí es un sub-modo de Cisco",
      getVendorProfile(full.vendor).prompt.isNested(full.prompt) === true,
      `vendor=${full.vendor} isNested=true`,
      `vendor=${full.vendor}: el sub-modo (config)# no se reconoce como tal`,
    );
  } finally {
    await scenario.cerrar();
  }
}



interface RowVendor {
  
  prompt: string;
  
  etiqueta: string;
  
  declarado: string | null;
  
  vendor: string;
  
  subMode: boolean;
}

const VENDORS: readonly RowVendor[] = [
  { prompt: "R1#", etiqueta: "Cisco raíz", declarado: "CISCO", vendor: "cisco", subMode: false },
  {
    prompt: "R1(config)#",
    etiqueta: "Cisco config",
    declarado: "CISCO",
    vendor: "cisco",
    subMode: true,
  },
  {
    prompt: "[R1-GigabitEthernet0/0]",
    etiqueta: "Huawei VRP vista",
    declarado: "HUAWEI",
    vendor: "huawei",
    subMode: true,
  },
  {
    prompt: "[admin@core-r1] /interface",
    etiqueta: "MikroTik menú",
    declarado: "MIKROTIK",
    vendor: "mikrotik",
    subMode: true,
  },
  {
    prompt: "[edit interfaces ge-0/0/0]",
    etiqueta: "JunOS edición",
    declarado: null,
    vendor: "junos",
    subMode: true,
  },
  {
    prompt: "(host) (config) #",
    etiqueta: "ArubaOS config",
    declarado: "ARUBA",
    vendor: "aruba",
    subMode: true,
  },
];


function vendorWithoutDeclarar(row: RowVendor): string {
  return row.prompt === "R1#" ? "conservative" : row.vendor;
}


async function caseTableOfVendors(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "tabla de prompts por vendor");
    return;
  }
  for (const row of VENDORS) {
    for (const declarado of [row.declarado, null] as (string | null)[]) {
      const level = declarado ? `declarado ${declarado}` : "detectado por prompt";
      const etiqueta = `vendor ${row.etiqueta} "${row.prompt}" (${level})`;
      const esperado = declarado ? row.vendor : vendorWithoutDeclarar(row);
      const scenario = await opciones.connect({
        escena: { prompt: row.prompt },
        typeDevice: declarado,
        prompt: row.prompt,
        name: row.etiqueta,
      });
      try {
        const snapshot = terminalSessionHub.getSnapshot(scenario.sessionId);
        assert(
          `${etiqueta}: el prompt se detecta`,
          snapshot?.prompt === row.prompt,
          `prompt=${JSON.stringify(snapshot?.prompt)}`,
          `prompt=${JSON.stringify(snapshot?.prompt)} (esperado ${JSON.stringify(row.prompt)}): ` +
            "el hub no reconoció esa forma de prompt",
        );
        assert(
          `${etiqueta}: el vendor se resuelve`,
          snapshot?.vendor === esperado,
          `vendor=${snapshot?.vendor}`,
          `vendor=${snapshot?.vendor} (esperado ${esperado})`,
        );
        assert(
          `${etiqueta}: el sub-modo ${row.subMode ? "se reconoce" : "NO se confunde con uno"}`,
          getVendorProfile(snapshot?.vendor).prompt.isNested(snapshot?.prompt) === row.subMode,
          `isNested(${JSON.stringify(snapshot?.prompt)}) === ${row.subMode} con vendor ${snapshot?.vendor}`,
          `isNested(${JSON.stringify(snapshot?.prompt)}) !== ${row.subMode} con vendor ` +
            `${snapshot?.vendor}: ` +
            (row.subMode
              ? "el agente se quedaría atrapado en el sub-modo y descartaría el exit"
              : "se confundiría la raíz con un sub-modo y se dejaría salir de la sesión"),
        );
      } finally {
        await scenario.cerrar();
      }
    }
  }
}


async function caseVendorEnTeamReal(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  const mockConsole = await opciones.connect({ escena: { prompt: null }, name: opciones.name });
  try {
    const snapshot = await waitPrompt(mockConsole.session, 20_000, opciones.prompt);
    assert(
      "equipo real: la consola entrega un prompt",
      Boolean(snapshot.prompt) && snapshot.promptWaitMessage === null,
      `prompt="${snapshot.prompt}" vendor=${snapshot.vendor}`,
      `la consola no dio un prompt${opciones.prompt ? ` esperado "${opciones.prompt}"` : ""}: ` +
        (snapshot.promptWaitMessage ?? `prompt detectado=${JSON.stringify(snapshot.prompt)}`),
    );
    assert(
      "equipo real: el vendor se resuelve desde el prompt",
      Boolean(snapshot.vendor) &&
        getVendorProfile(snapshot.vendor).prompt.isNested(snapshot.prompt) !== undefined,
      `vendor=${snapshot.vendor} prompt="${snapshot.prompt}" ` +
        `sub-modo=${getVendorProfile(snapshot.vendor).prompt.isNested(snapshot.prompt)}`,
      `vendor=${JSON.stringify(snapshot.vendor)}: no se pudo resolver el perfil del equipo`,
    );
  } finally {
    await mockConsole.cerrar();
  }
}



async function casePreFlightWithoutPrompt(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "pre-flight sin prompt");
    return;
  }
  const scenario = await opciones.connect({

    escena: {
      prompt: null,
      retardoSaludoMs: 0,
      commands: { "show version": { lines: ["R1 Software, Version 15.2"] } },
    },
    typeDevice: opciones.kindDevice ?? "CISCO",
    prompt: null,
    name: "sin-prompt",
  });
  try {

    let mensaje = "";
    let lanzo = false;
    try {
      await terminalSessionHub.sendCommandDetailed(scenario.session, "show version", {
        preflight: { timeoutMs: 400 },
      });
    } catch (error) {
      lanzo = true;
      mensaje = error instanceof Error ? error.message : String(error);
    }
    assert(
      "pre-flight sin prompt: el envío se rechaza con motivo",
      lanzo && /prompt/i.test(mensaje),
      `error informativo: ${mensaje.slice(0, 130)}`,
      lanzo
        ? `el error no menciona el prompt: ${mensaje}`
        : "el envío NO se rechazó: se escribió a ciegas y el prompt pendiente se comería el comando",
    );
    const escrita = scenario.mock;
    assert(
      "pre-flight sin prompt: el equipo NO vio ninguna línea de comando",
      escrita?.lines.length === 0 && escrita?.raw === "",
      `el equipo no recibió nada (crudo=${JSON.stringify(escrita?.raw)})`,
      `el equipo recibió líneas ${JSON.stringify(escrita?.lines)} ` +
        `(crudo=${JSON.stringify(escrita?.raw.slice(0, 120))}): se escribió sin prompt`,
    );
    assert(
      "pre-flight sin prompt: la sesión sigue viva",
      terminalSessionHub.checkConnectionStatus(scenario.sessionId) === true,
      "la sesión sigue registrada y viva",
      "la sesión ya no está viva: el pre-flight cerró la consola",
    );

    let reason: string = "";
    let consejo = "";
    try {
      await terminalSessionHub.sendCommandDetailed(scenario.session, "show version", {
        preflight: { timeoutMs: 300 },
      });
    } catch (error: any) {
      reason = String(error?.motivoSinPrompt ?? "");
      consejo = String(error?.diagnostico?.consejo ?? "");
    }
    assert(
      "pre-flight sin prompt: el motivo es sin_salida y el consejo habla de encenderlo",
      reason === "sin_salida" && /apagado/i.test(consejo) && /setPower|controlGns3NodePower/.test(consejo),
      `motivoSinPrompt=${reason} consejo=${JSON.stringify(consejo.slice(0, 150))}`,
      `motivoSinPrompt=${JSON.stringify(reason)} consejo=${JSON.stringify(consejo.slice(0, 200))}: ` +
        "una consola muda se diagnostica como otra cosa o el consejo no dice cómo arreglarlo",
    );
  } finally {
    await scenario.cerrar();
  }
}



async function caseRuidoOfMockConsole(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "ruido de consola (banner)");
    return;
  }
  const scenario = await opciones.connect({
    escena: {
      prompt: "R1#",
      banner: [
        "**************************************************************************",
        "* Packet Tools consola de prueba: banner de ruido, como el de un equipo real. *",
        "**************************************************************************",
      ].join("\r\n"),
      commands: {
        "show ip interface brief": {
          lines: [
            "Interface              IP-Address      OK? Method Status                Protocol",
            "GigabitEthernet0/0     10.0.0.1        YES NVRAM  up                    up",
            "GigabitEthernet0/1     unassigned      YES NVRAM  administratively down down",
          ],
        },
      },
    },
    typeDevice: opciones.kindDevice ?? "CISCO",
    prompt: "R1#",
    name: "ruido-consola",
  });
  try {
    const r = await terminalSessionHub.sendCommandDetailed(
      scenario.session,
      "show ip interface brief",
      DIAGNOSTICO,
    );
    assert(
      "ruido de consola: la salida reportada es la del comando, no el banner",
      r.output.includes("GigabitEthernet0/1") && !r.output.includes("banner de ruido"),
      `la salida es la del comando (${r.output.length} chars, sin banner)`,
      `la salida del comando vino mezclada con el banner: ${JSON.stringify(r.output.slice(0, 240))}`,
    );
    assert(
      "ruido de consola: el banner sí queda en el historial de la consola",
      (terminalSessionHub.getSnapshot(scenario.sessionId)?.lastLines ?? []).some((l) =>
        l.includes("banner de ruido"),
      ) === true,
      "read_terminal sí ve el banner (está en el historial de la consola)",
      "el banner no aparece en el historial: el ruido se perdió al registrar la sesión",
    );
  } finally {
    await scenario.cerrar();
  }
}




async function caseNoCerrarSession(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (sePuede(opciones)) {
    await caseNoCerrarSessionMock(admin, url, opciones);
    return;
  }
  await caseNoCerrarSessionReal(admin, url, opciones);
}

async function caseNoCerrarSessionMock(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {

  const cisco = await opciones.connect({
    escena: {
      prompt: "R1#",
      commands: { "show clock": { lines: ["*09:41:00.000 UTC Fri Oct 3 2026"] } },
    },
    typeDevice: "CISCO",
    prompt: "R1#",
    name: "cisco-raiz",
  });
  try {
    for (const command of ["quit", "exit"]) {
      let mensaje = "";
      let lanzo = false;
      try {
        await terminalSessionHub.sendCommandDetailed(cisco.session, command);
      } catch (error) {
        lanzo = true;
        mensaje = error instanceof Error ? error.message : String(error);
      }
      assert(
        `no cerrar sesión: "${command}" en la raíz Cisco se rechaza`,
        lanzo,
        `rechazado: ${mensaje.slice(0, 120)}`,
        `"${command}" en "R1#" NO se rechazó: el agente habría cerrado la consola del usuario`,
      );
    }

    const lote = await terminalSessionHub.runCommandsDetailed(
      cisco.session,
      ["show clock", "quit"],
      DIAGNOSTICO,
    );
    assert(
      "no cerrar sesión: el lote descarta el cierre y ejecuta el resto",
      lote.executed.length === 1 &&
        lote.executed[0] === "show clock" &&
        lote.removed.length === 1 &&
        lote.removed[0] === "quit" &&
        lote.removedReason !== null,
      `executed=${JSON.stringify(lote.executed)} removed=${JSON.stringify(lote.removed)}`,
      `executed=${JSON.stringify(lote.executed)} removed=${JSON.stringify(lote.removed)} ` +
        `removedReason=${JSON.stringify(lote.removedReason)}`,
    );
    assert(
      "no cerrar sesión: el equipo NUNCA vio el cierre",
      !(cisco.mock?.lines ?? []).some((l) => /^(quit|exit)$/i.test(l.trim())),
      `el equipo solo vio ${JSON.stringify(cisco.mock?.lines)}`,
      `el equipo vio ${JSON.stringify(cisco.mock?.lines)}: se le envió un cierre`,
    );
    assert(
      "no cerrar sesión: la salida del lote es la del comando válido",
      lote.output.includes("UTC Fri Oct 3"),
      "la salida capturada es la de show clock",
      `la salida del lote no es la de show clock: ${JSON.stringify(lote.output.slice(0, 180))}`,
    );
  } finally {
    await cisco.cerrar();
  }


  const huawei = await opciones.connect({
    escena: {
      prompt: "[R1-GigabitEthernet0/0]",
      commands: { quit: { lines: [" quitting"] } },
    },
    typeDevice: "HUAWEI",
    prompt: "[R1-GigabitEthernet0/0]",
    name: "huawei-vista",
  });
  try {
    const r = await terminalSessionHub.sendCommandDetailed(huawei.session, "quit", DIAGNOSTICO);
    assert(
      'no cerrar sesión: "quit" Sí sale del sub-modo de Huawei',
      r.executed.includes("quit") && r.removed.length === 0,
      `executed=${JSON.stringify(r.executed)} removed=${JSON.stringify(r.removed)}`,
      `executed=${JSON.stringify(r.executed)} removed=${JSON.stringify(r.removed)}: la vista de ` +
        "Huawei se trató como prompt raíz y el agente se queda atrapado reportando éxito",
    );
    assert(
      "no cerrar sesión: el equipo Huawei vio el quit (salió de la vista, no de la sesión)",
      (huawei.mock?.lines ?? []).includes("quit"),
      `el equipo vio ${JSON.stringify(huawei.mock?.lines)}`,
      `el equipo NO vio el quit (${JSON.stringify(huawei.mock?.lines)}): el ` +
        "comando se descartó en silencio pese a estar en un sub-modo legítimo",
    );
  } finally {
    await huawei.cerrar();
  }
}

async function caseNoCerrarSessionReal(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  const mockConsole = await opciones.connect({ escena: { prompt: null }, name: opciones.name });
  try {
    const snapshot = await waitPrompt(mockConsole.session, 20_000, opciones.prompt);
    const subMode = getVendorProfile(snapshot.vendor).prompt.isNested(snapshot.prompt) === true;
    let mensaje = "";
    let lanzo = false;
    try {
      await terminalSessionHub.sendCommandDetailed(mockConsole.session, "quit");
    } catch (error) {
      lanzo = true;
      mensaje = error instanceof Error ? error.message : String(error);
    }
    assert(
      "equipo real: quit no se envía a ciegas en la raíz",
      subMode ? true : lanzo,
      subMode
        ? `la consola está en un sub-modo ("${snapshot.prompt}"): el quit sale de la capa, no de la sesión`
        : `rechazado: ${mensaje.slice(0, 120)}`,
      subMode
        ? `la consola está en "${snapshot.prompt}" y el quit no se envió: el agente se quedaría atrapado`
        : `"quit" no se rechazó con el prompt "${snapshot.prompt}": el agente cerraría la consola`,
    );
  } finally {
    await mockConsole.cerrar();
  }
}




function linesRunningConfig(cantidad: number): string[] {
  const output: string[] = ["Building configuration...", "!"];
  for (let i = 1; i <= cantidad; i += 1) {
    output.push(` interface GigabitEthernet0/${i}`);
    output.push(`  description ENLACE-${i}-CONFIGURADO`);
    output.push("!");
  }
  output.push("end");
  return output;
}

async function caseOutputLong(admin: AdminSuite, url: string, opciones: OpcionesSuite) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "salida larga sin paginar|salida lenta");
    return;
  }
  const lines = linesRunningConfig(400);
  const esperado = lines.join("\r\n").length;
  const scenario = await opciones.connect({
    escena: { prompt: "R1#", commands: { "show running-config": { lines } } },
    typeDevice: opciones.kindDevice ?? "CISCO",
    prompt: "R1#",
    name: "salida-larga",
  });
  try {
    const r = await terminalSessionHub.sendCommandDetailed(
      scenario.session,
      "show running-config",
      DIAGNOSTICO,
    );
    assert(
      "salida larga sin paginar: llega entera y sin inventar paginación",
      r.output.includes("ENLACE-400-CONFIGURADO") &&
        r.output.includes("end") &&
        r.paged === false &&
        r.pages === 0,
      `${r.output.length} chars, paged=${r.paged}, llega hasta ENLACE-400-CONFIGURADO`,
      `largo=${r.output.length} paged=${r.paged} pages=${r.pages} ` +
        `llegaAlFinal=${r.output.includes("ENLACE-400-CONFIGURADO")}`,
    );
    assert(
      "salida larga sin paginar: termina por inactividad, no por plazo",
      r.endReason === "idle" && r.timedOut === false,
      `endReason=${r.endReason} timedOut=${r.timedOut} elapsedMs=${r.elapsedMs}`,
      `endReason=${r.endReason} timedOut=${r.timedOut} elapsedMs=${r.elapsedMs}`,
    );
    assert(
      "salida larga sin paginar: no se perdió texto por el tope de captura",
      r.output.length >= esperado * 0.9,
      `${r.output.length} chars capturados de ~${esperado} esperados (con eco y prompt)`,
      `solo ${r.output.length} chars de ~${esperado} esperados: la captura se quedó corta`,
    );
  } finally {
    await scenario.cerrar();
  }


  const lentas = linesRunningConfig(30);
  const esperadoSlow = lentas.join("\r\n").length;
  const slow = await opciones.connect({
    escena: {
      prompt: "R1#",
      commands: { "show running-config": { lines: lentas, retardoCharMs: 2 } },
    },
    typeDevice: opciones.kindDevice ?? "CISCO",
    prompt: "R1#",
    name: "salida-lenta",
  });
  try {
    const r = await terminalSessionHub.sendCommandDetailed(
      slow.session,
      "show running-config",
      { idleMs: 700, maxMs: 25_000 },
    );
    assert(
      "salida lenta: no se corta antes de tiempo",
      r.output.includes("ENLACE-30-CONFIGURADO") && r.endReason === "idle",
      `llegó al final en ${r.elapsedMs} ms (endReason=${r.endReason})`,
      `se cortó a medias: endReason=${r.endReason} elapsedMs=${r.elapsedMs} ` +
        `llegaAlFinal=${r.output.includes("ENLACE-30-CONFIGURADO")} ` +
        `final=${JSON.stringify(r.output.slice(-140))}`,
    );
    assert(
      "salida lenta: se capturó casi todo el texto",
      r.output.length >= esperadoSlow * 0.9,
      `${r.output.length} chars capturados de ~${esperadoSlow} esperados`,
      `solo ${r.output.length} chars de ~${esperadoSlow} esperados: la espera cortó antes`,
    );
  } finally {
    await slow.cerrar();
  }
}




async function caseLogin(admin: AdminSuite, url: string, opciones: OpcionesSuite) {
  if (!sePuede(opciones)) {
    skipSimulados(
      opciones,
      "login|login pendiente (MikroTik): el motivo es login_pendiente y el consejo pide autenticarse a mano",
    );
    return;
  }
  const scenario = await opciones.connect({
    escena: {
      prompt: "R1#",
      login: { userValid: "admin", passwordValid: "admin123" },
    },
    typeDevice: opciones.kindDevice ?? "CISCO",

    prompt: null,
    name: "con-login",
  });
  try {
    let mensaje = "";
    let lanzo = false;
    try {
      await terminalSessionHub.sendCommandDetailed(scenario.session, "show version", {
        preflight: { timeoutMs: 500 },
      });
    } catch (error) {
      lanzo = true;
      mensaje = error instanceof Error ? error.message : String(error);
    }
    assert(
      "login: no se escribe a ciegas mientras pide credenciales",
      lanzo && /prompt/i.test(mensaje),
      `rechazado con motivo: ${mensaje.slice(0, 120)}`,
      lanzo
        ? `el error no menciona el prompt: ${mensaje}`
        : "se escribió sin prompt con la consola pidiendo el login",
    );
    assert(
      "login: el equipo no vio el comando (se lo habría comido el login)",
      (scenario.mock?.lines ?? []).length === 0,
      `el equipo solo vio la petición de login (crudo=${JSON.stringify(scenario.mock?.raw)})`,
      `el equipo vio ${JSON.stringify(scenario.mock?.lines)}: el comando se perdió en el login`,
    );

    assert(
      "login: ni se envía el comando ni un Return de despertar",
      (scenario.mock?.returns ?? 0) === 0 && scenario.mock?.raw === "",
      "la consola no recibió ni un byte del cliente",
      `returns=${scenario.mock?.returns} crudo=${JSON.stringify(scenario.mock?.raw)}: ` +
        "se mandó una tecla a un login pendiente",
    );
  } finally {
    await scenario.cerrar();
  }


  const mikrotik = await opciones.connect({
    escena: {
      prompt: "[admin@MikroTik] >",
      login: {

        user: "MikroTik Login",
        userValid: "admin",
        passwordValid: "admin",
      },
    },
    typeDevice: "MIKROTIK",
    prompt: null,
    name: "login-mikrotik",
  });
  try {
    let mensaje = "";
    let reason = "";
    let consejo = "";
    let pending = "";
    let lanzo = false;
    try {
      await terminalSessionHub.sendCommandDetailed(mikrotik.session, "/system identity print", {
        preflight: { timeoutMs: 600 },
      });
    } catch (error: any) {
      lanzo = true;
      mensaje = error instanceof Error ? error.message : String(error);

      reason = String(error?.motivoSinPrompt ?? "");
      consejo = String(error?.diagnostico?.consejo ?? "");
      pending = String(error?.diagnostico?.pendiente ?? "");
    }
    assert(
      "login pendiente (MikroTik): no se escribe NADA, ni comando ni Return",
      lanzo &&
        mikrotik.mock !== null &&
        (mikrotik.mock?.lines.length ?? 0) === 0 &&
        (mikrotik.mock?.returns ?? 0) === 0 &&
        mikrotik.mock?.raw === "",
      "la consola no vio ni una tecla del cliente",
      `lineas=${JSON.stringify(mikrotik.mock?.lines)} ` +
        `returns=${mikrotik.mock?.returns} crudo=${JSON.stringify(mikrotik.mock?.raw)}`,
    );
    assert(
      "login pendiente (MikroTik): el motivo es login_pendiente (no 'arrancando')",
      reason === "login_pendiente",
      `motivoSinPrompt=${reason} pendiente=${JSON.stringify(pending)} ` +
        `mensaje=${JSON.stringify(mensaje.slice(0, 150))}`,
      `motivoSinPrompt=${JSON.stringify(reason)} (esperado "login_pendiente") ` +
        `mensaje=${mensaje}: el motor no sabe por qué no hay prompt, o lo dice mal`,
    );
    assert(
      "login pendiente (MikroTik): el consejo dice que hay que autenticarse A MANO",
      /autent[í]cate|autentica|credenciales/i.test(consejo || mensaje) &&
        !/termine de arrancar/i.test(mensaje),
      `consejo=${JSON.stringify((consejo || mensaje).slice(0, 160))}`,
      `el consejo no dice que hay que autenticarse en la terminal: ` +
        `${JSON.stringify((consejo || mensaje).slice(0, 200))} … o peor, afirma que el ` +
        "equipo está arrancando cuando lo que hay en pantalla es un login",
    );
    assert(
      "login pendiente (MikroTik): el snapshot también lleva el motivo y la línea",
      (() => {
        const s = terminalSessionHub.getSnapshot(mikrotik.sessionId);
        return (
          s?.motivoSinPrompt === "login_pendiente" &&
          /mikrotik login/i.test(String(s?.ultimaLinea ?? ""))
        );
      })(),
      (() => {
        const s = terminalSessionHub.getSnapshot(mikrotik.sessionId);
        return `motivoSinPrompt=${s?.motivoSinPrompt} ultimaLinea=${JSON.stringify(s?.ultimaLinea)}`;
      })(),
      (() => {
        const s = terminalSessionHub.getSnapshot(mikrotik.sessionId);
        return `motivoSinPrompt=${JSON.stringify(s?.motivoSinPrompt)} ` +
          `ultimaLinea=${JSON.stringify(s?.ultimaLinea)}: el snapshot no dice por qué ` +
          "no hay prompt y la tool tiene que adivinarlo del texto";
      })(),
    );
    assert(
      "login pendiente (MikroTik): la sesión sigue viva (el login es del usuario)",
      terminalSessionHub.checkConnectionStatus(mikrotik.sessionId) === true,
      "la sesión sigue registrada y viva para que el usuario pueda teclear",
      "la sesión ya no está viva: el motor cerró la consola del usuario",
    );
  } finally {
    await mikrotik.cerrar();
  }
}


  dialogSeAnswers: boolean;
  
  esperado: string[];
  
  verify: string;
  
  outputVerify: string;
  
  modeFinal: string;
}

const MARKERS_CONFIG: readonly RowConfigMarker[] = [
  {
    etiqueta: "Cisco IOS",
    declarado: "CISCO",
    vendor: "cisco",
    prompt: "R1>",
    promptPrivilegiado: "R1#",
    promptConfig: "R1(config)#",
    command: "interface GigabitEthernet0/1",
    guardar: true,

    dialog: {
      question: "Building configuration...\r\nDestination filename [startup-config]?",
      wait: "",
      output: "[OK]",
    },
    dialogSeAnswers: true,
    esperado: [
      "terminal length 0",
      "no ip domain-lookup",
      "enable",
      "configure terminal",
      "interface GigabitEthernet0/1",
      "write memory",
      "exit",
    ],
    verify: "show ip interface brief",
    outputVerify: "GigabitEthernet0/1 10.0.0.1 YES manual up up",
    modeFinal: "privilegiado",
  },
  {
    etiqueta: "Cisco NX-OS / IOS-XE",
    declarado: "CISCO",
    vendor: "cisco",
    prompt: "R1#",
    promptPrivilegiado: "R1#",
    promptConfig: "R1(config)#",
    command: "interface ethernet 1/1",
    guardar: false,
    dialogSeAnswers: false,

    esperado: [
      "terminal length 0",
      "no ip domain-lookup",
      "configure terminal",
      "interface ethernet 1/1",
      "exit",
    ],
    verify: "show interface ethernet 1/1 brief",
    outputVerify: "Ethernet1/1 is up",
    modeFinal: "privilegiado",
  },
  {
    etiqueta: "Huawei VRP",
    declarado: "HUAWEI",
    vendor: "huawei",
    prompt: "<Huawei>",
    promptPrivilegiado: "<Huawei>",
    promptConfig: "[Huawei]",
    command: "interface GigabitEthernet0/0/0",
    guardar: true,

    dialog: {
      question: "The current configuration will be written to the device.\r\nAre you sure to continue?[Y/N]:",
      wait: "y",
    },
    dialogSeAnswers: false,
    esperado: [
      "screen-length 0 temporary",
      "undo ip domain-lookup",
      "system-view",
      "interface GigabitEthernet0/0/0",
      "save",
    ],
    verify: "display ip interface brief",
    outputVerify: "GigabitEthernet0/0/0 10.0.0.1 UP",
    modeFinal: "config",
  },
  {
    etiqueta: "MikroTik RouterOS",
    declarado: "MIKROTIK",
    vendor: "mikrotik",
    prompt: "[admin@core-r1] >",
    promptPrivilegiado: "[admin@core-r1] >",

    promptConfig: null,
    command: "/interface bridge add name=puente1",
    guardar: true,
    dialogSeAnswers: false,

    esperado: ["/interface bridge add name=puente1"],
    verify: "/interface bridge print",
    outputVerify: "0 R  name=puente1",
    modeFinal: "privilegiado",
  },
  {
    etiqueta: "Juniper JunOS",
    declarado: null,
    vendor: "junos",
    prompt: "user@vsrx>",
    promptPrivilegiado: "user@vsrx>",

    promptConfig: null,
    command: "set system host-name vsrx-1",
    guardar: true,
    dialog: {
      question: "warning: the following changes have been committed\r\nDo you want to proceed with commit? [yes,no] (no)",
      wait: "yes",
    },
    dialogSeAnswers: false,
    esperado: [
      "set cli screen-length 0",
      "set system host-name vsrx-1",
      "commit",
    ],
    verify: "show version",
    outputVerify: "Hostname: vsrx-1",
    modeFinal: "config",
  },
  {
    etiqueta: "ArubaOS",
    declarado: "ARUBA",
    vendor: "aruba",
    prompt: "(host) #",
    promptPrivilegiado: "(host) #",
    promptConfig: "(host) (config) #",
    command: "vlan 10",
    guardar: true,
    dialogSeAnswers: false,

    esperado: ["configure terminal", "vlan 10", "exit"],
    verify: "show vlan 10",
    outputVerify: "VLAN 10  up",
    modeFinal: "privilegiado",
  },
  {
    etiqueta: "VyOS",
    declarado: "GENERIC",
    vendor: "conservative",
    prompt: "vyos@vyos:~$",
    promptPrivilegiado: "vyos@vyos:~$",
    promptConfig: null,
    command: "set system host-name vyos-1",
    guardar: true,
    dialogSeAnswers: false,

    esperado: ["set system host-name vyos-1"],
    verify: "show version",
    outputVerify: "Uptime: 3 days",
    modeFinal: "desconocido",
  },
  {
    etiqueta: "Fortinet",
    declarado: "GENERIC",
    vendor: "conservative",
    prompt: "FGT #",
    promptPrivilegiado: "FGT #",
    promptConfig: null,
    command: "config system interface port1 set ip 10.0.0.1 255.255.255.0",
    guardar: true,
    dialogSeAnswers: false,
    esperado: ["config system interface port1 set ip 10.0.0.1 255.255.255.0"],
    verify: "get system interface physical",
    outputVerify: "port1 up",
    modeFinal: "privilegiado",
  },
  {
    etiqueta: "Genérico desconocido",
    declarado: null,
    vendor: "conservative",
    prompt: "rtr>",
    promptPrivilegiado: "rtr>",
    promptConfig: null,
    command: "set hostname rtr",
    guardar: true,
    dialogSeAnswers: false,
    esperado: ["set hostname rtr"],
    verify: "show system",
    outputVerify: "Hostname: rtr",
    modeFinal: "privilegiado",
  },
];


async function caseConfigByMarker(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(
      opciones,
      "ciclo de configuración por marca (configure_device ? hub)",
    );
    return;
  }

  for (const marker of MARKERS_CONFIG) {
    const etq = `config ${marker.etiqueta}`;
    
    const aborta = Boolean(marker.dialog) && !marker.dialogSeAnswers;
    const esperadoSeen = aborta ? marker.esperado : [...marker.esperado, marker.verify];
    
    const commands: Record<string, { promptFinal?: string | null; lines?: string[] }> = {};
    if (marker.promptConfig) {

      const aConfig = getVendorProfile(marker.vendor).transiciones.aConfig;
      if (aConfig) commands[aConfig] = { promptFinal: marker.promptConfig };
      const salir = getVendorProfile(marker.vendor).transiciones.salirDeConfig;
      if (salir) commands[salir] = { promptFinal: marker.promptPrivilegiado };

      const aPrivilegiado = getVendorProfile(marker.vendor).transiciones.aPrivilegiado;
      if (aPrivilegiado) commands[aPrivilegiado] = { promptFinal: marker.promptPrivilegiado };
    }
    commands[marker.verify] = {
      lines: [marker.outputVerify],
      promptFinal: marker.promptPrivilegiado,
    };

    const escena: EscenaMockConsole = { prompt: marker.prompt, commands };
    if (marker.dialog) {
      const guardar = getVendorProfile(marker.vendor).transiciones.guardarConfig;
      if (guardar) escena.dialogos = { [guardar]: marker.dialog };
    }

    const mockConsole = await opciones.connect({
      escena,
      typeDevice: marker.declarado,
      prompt: marker.prompt,
      name: `config-${marker.etiqueta}`,
    });
    try {
      const r = await terminalSessionHub.runConfigDetailed(mockConsole.session, {
        commands: [marker.command],
        guardar: marker.guardar,
        verifyCommands: [marker.verify],
        ...CONFIG_CI,
      });
      const seen = mockConsole.mock?.lines ?? [];
      const dialogos = mockConsole.mock?.dialogos ?? [];

      assert(
        `${etq}: el motor escribe EXACTAMENTE las líneas que declara el perfil`,
        seen.join(" | ") === esperadoSeen.join(" | "),
        `el equipo vio ${JSON.stringify(seen)}`,
        `el equipo vio ${JSON.stringify(seen)} y el motor tenía que escribir ` +
          `${JSON.stringify(esperadoSeen)}: inventó (o se saltó) alguna línea`,
      );

      assert(
        `${etq}: el vendor del ciclo es ${marker.vendor}`,
        r.vendor === marker.vendor,
        `vendor=${r.vendor} (${r.vendorLabel})`,
        `vendor=${r.vendor} (esperado ${marker.vendor})`,
      );

      if (marker.promptConfig) {

        assert(
          `${etq}: entra en el modo de configuración "${marker.promptConfig}"`,
          r.entramosEnConfig &&
            (r.abortado || r.modeFinal === marker.modeFinal),
          `entramosEnConfig=${r.entramosEnConfig} modoFinal=${r.modeFinal} ` +
            `promptFinal=${JSON.stringify(r.promptFinal)} abortado=${r.abortado}`,
          `entramosEnConfig=${r.entramosEnConfig} modoFinal=${r.modeFinal} ` +
            `promptFinal=${JSON.stringify(r.promptFinal)}: el motor no llevó la consola al ` +
            `modo de configuración de esta marca (esperado "${marker.modeFinal}")`,
        );
      } else {
        assert(
          `${etq}: sin modo de configuración declarado, el lote va al modo actual`,
          !r.entramosEnConfig && seen.includes(marker.command),
          `modoFinal=${r.modeFinal} el equipo vio ${JSON.stringify(seen)}`,
          `entramosEnConfig=${r.entramosEnConfig} visto=${JSON.stringify(seen)}: ` +
            "esta marca no declara `aConfig` y el motor no debería transicionar",
        );
      }


      if (marker.dialog) {
        assert(
          `${etq}: el diálogo "${marker.dialog.question.split(/\r?\n/).pop()}" se ` +
            `${marker.dialogSeAnswers ? "contesta SOLO por ser del perfil" : "devuelve SIN contestar"}`,
          dialogos.length === 1 &&
            dialogos[0].question.includes(marker.dialog.question.split(/\r?\n/).pop() ?? "") &&
            (marker.dialogSeAnswers
              ? dialogos[0].recibida === marker.dialog.wait
              : dialogos[0].recibida === null),
          `preguntó=${JSON.stringify(dialogos[0]?.question?.slice(-60))} ` +
            `recibida=${JSON.stringify(dialogos[0]?.recibida)}`,
          `dialogos=${JSON.stringify(dialogos)}: el motor ` +
            `${marker.dialogSeAnswers ? "NO contestó" : "contestó"} una confirmación que ` +
            `${marker.dialogSeAnswers ? "el perfil declara como propia" : "es del usuario"}`,
        );
        if (marker.dialogSeAnswers) {
          assert(
            `${etq}: el diálogo contestado queda diagnosticado con su respuesta`,
            r.dialogos.length === 1 &&
              r.dialogos[0].tipo === "confirmacion_propia" &&
              r.dialogos[0].fase === "guardar" &&
              r.dialogos[0].reply === marker.dialog.wait,
            `dialogo=${JSON.stringify(r.dialogos[0])}`,
            `dialogos=${JSON.stringify(r.dialogos)}: no se puede saber qué se respondió ni por qué`,
          );
        } else {
          assert(
            `${etq}: el lote se aborta y el diálogo vuelve al agente`,
            r.abortado && r.dialogoPendiente !== null && r.motivoAborto === "pregunta_al_usuario",
            `abortado=${r.abortado} motivo=${r.motivoAborto} ` +
              `dialogoPendiente=${JSON.stringify(r.dialogoPendiente?.text)}`,
            `abortado=${r.abortado} motivo=${r.motivoAborto} ` +
              `dialogoPendiente=${JSON.stringify(r.dialogoPendiente?.text)}: ` +
              "una pregunta al usuario debe parar el lote y volver al agente",
          );
        }
      } else {
        assert(
          `${etq}: sin diálogo, no se inventa ninguno`,
          dialogos.length === 0 && r.dialogos.length === 0,
          `el equipo no preguntó nada y el motor no registró diálogos`,
          `el equipo preguntó ${JSON.stringify(dialogos)} y el motor registró ` +
            `${JSON.stringify(r.dialogos)}`,
        );
      }


      assert(
        `${etq}: ${
          r.abortado
            ? "la verificación NO se da por hecha porque el lote se paró"
            : "la verificación se lee del equipo y es completa"
        }`,
        r.verificacion !== null &&
          r.verificacion.completa === !r.abortado &&
          (r.abortado
            ? /NO des por aplicado/.test(r.verificacion.reason ?? "")
            : r.verificacion.resultados[0]?.output.includes(marker.outputVerify) === true),
        `abortado=${r.abortado} verificacion=${JSON.stringify(r.verificacion?.resultados[0]?.output?.slice(0, 100))}` +
          (r.abortado ? ` motivo=${r.verificacion?.reason}` : ""),
        `abortado=${r.abortado} verificacion=${JSON.stringify(r.verificacion)}: ${
          r.abortado
            ? "habría que decir que no se verificó"
            : "no se pudo leer lo aplicado, así que no puede darse por configurado"
        }`,
    );
    } finally {
      await mockConsole.cerrar();
    }
  }
}




async function caseSalirOfConfigComprobado(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(
      opciones,
      "salida del modo configuración comprobada (exit perdido / imposible)",
    );
    return;
  }

  
  const escenaWithExitPerdido = (teclasPerdidas: number): EscenaMockConsole => ({
    prompt: "R1#",
    commands: {
      "configure terminal": { promptFinal: "R1(config)#" },
      "interface FastEthernet0/0": { promptFinal: "R1(config-if)#" },

      exit: { teclasPerdidas },
      "show running-config | include description": {
        lines: ["description PT-PROBA-532855"],
      },
    },
    outputOfConfig: { command: "exit", niveles: ["R1(config)#", "R1#"] },
  });
  const lote = ["interface FastEthernet0/0", "description PT-PROBA-532855"];


  const recupera = await opciones.connect({
    escena: escenaWithExitPerdido(1),
    typeDevice: "CISCO",
    prompt: "R1#",
    name: "config-exit-perdido",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(recupera.session, {
      commands: lote,
      verifyCommands: ["show running-config | include description"],
      ...CONFIG_CI,
    });
    assert(
      "config: un `exit` que el equipo pierde la PRIMERA vez sale al reintento y la consola vuelve a `R1#`",
      !r.abortado &&
        r.salioDeConfig &&

        r.intentosSalida === 3 &&
        r.modeFinal === "privilegiado" &&
        r.promptFinal === "R1#" &&
        (recupera.mock?.teclasPerdidas ?? 0) === 1,
      `salioDeConfig=${r.salioDeConfig} intentosSalida=${r.intentosSalida} ` +
        `modoFinal=${r.modeFinal} promptFinal=${JSON.stringify(r.promptFinal)} ` +
        `teclasPerdidas=${recupera.mock?.teclasPerdidas}`,
      `salioDeConfig=${r.salioDeConfig} intentosSalida=${r.intentosSalida} ` +
        `modoFinal=${r.modeFinal} promptFinal=${JSON.stringify(r.promptFinal)} ` +
        `teclasPerdidas=${recupera.mock?.teclasPerdidas}: ` +
        "el motor no reintentó la salida del modo configuración (o la dio por buena sin comprobar " +
        "que el prompt cambió: es el fallo medido en el Cisco real)",
    );
    assert(
      "config: con la consola fuera del sub-modo la verificación Sí se ejecuta y se lee",
      r.verificacion?.completa === true &&
        r.verificacion.resultados[0]?.output.includes("PT-PROBA-532855"),
      `verificacion=${JSON.stringify(r.verificacion?.resultados[0]?.output?.slice(0, 80))} ` +
        `completa=${r.verificacion?.completa}`,
      `verificacion=${JSON.stringify(r.verificacion)}: ` +
        "no se pudo releer lo aplicado aunque la consola ya está en `R1#`",
    );
  } finally {
    await recupera.cerrar();
  }


  const atascado = await opciones.connect({
    escena: escenaWithExitPerdido(-1),
    typeDevice: "CISCO",
    prompt: "R1#",
    name: "config-exit-imposible",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(atascado.session, {
      commands: lote,
      verifyCommands: ["show running-config | include description"],
      ...CONFIG_CI,
    });
    assert(
      "config: si no hay manera de salir del sub-modo, `salioDeConfig` es false y el aviso lo dice",
      r.salioDeConfig === false &&
        r.abortado &&
        r.motivoAborto === "no_se_sale_de_config" &&
        r.modeFinal === "config" &&
        r.promptFinal === "R1(config-if)#" &&
        (r.avisoSalida ?? "").includes("R1(config-if)#") &&
        /configuración de interfaz/.test(r.avisoSalida ?? ""),
      `salioDeConfig=${r.salioDeConfig} abortado=${r.abortado} motivo=${r.motivoAborto} ` +
        `modoFinal=${r.modeFinal} promptFinal=${JSON.stringify(r.promptFinal)} ` +
        `aviso=${JSON.stringify(r.avisoSalida?.slice(0, 140))}`,
      `salioDeConfig=${r.salioDeConfig} abortado=${r.abortado} motivo=${r.motivoAborto} ` +
        `modoFinal=${r.modeFinal} promptFinal=${JSON.stringify(r.promptFinal)} ` +
        `aviso=${JSON.stringify(r.avisoSalida)}: un 'se envió' con la consola en \`(config-if)#\` ` +
        "es el fallo de contrato: el siguiente comando del agente falla sin explicación",
    );
    assert(
      "config: el reintento de la salida es ACOTADO y el aviso dice cuántos intentos hizo",
      r.intentosSalida > 1 &&
        r.intentosSalida <= 4 &&
        new RegExp(`${r.intentosSalida} (vez|veces)`).test(r.avisoSalida ?? ""),
      `intentosSalida=${r.intentosSalida} aviso=${JSON.stringify(r.avisoSalida?.slice(0, 200))}`,
      `intentosSalida=${r.intentosSalida} aviso=${JSON.stringify(r.avisoSalida?.slice(0, 200))}: ` +
        "o no se insiste (y entonces el aviso no lo dice), o se insiste sin tope (y nunca se rinde)",
    );
    assert(
      "config: con la consola en un sub-modo NO se intenta verificar (esos comandos fallarían)",
      r.verificacion?.completa === false &&
        r.verificacion.reason?.includes("no_se_sale_de_config") === true &&
        (atascado.mock?.lines ?? []).filter((l) => l.startsWith("show ")).length === 0,
      `completa=${r.verificacion?.completa} motivo=${JSON.stringify(r.verificacion?.reason?.slice(0, 120))} ` +
        `escrito=${JSON.stringify(atascado.mock?.lines)}`,
      `verificacion=${JSON.stringify(r.verificacion)} ` +
        `escrito=${JSON.stringify(atascado.mock?.lines)}: ` +
        "se intentó verificar desde `(config-if)#` (donde no vale) o se dio por aplicado lo no leído",
    );
  } finally {
    await atascado.cerrar();
  }


  const niveles = await opciones.connect({
    escena: escenaWithExitPerdido(0),
    typeDevice: "CISCO",
    prompt: "R1#",
    name: "config-exit-niveles",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(niveles.session, {
      commands: lote,
      ...CONFIG_CI,
    });
    assert(
      "config: de `(config-if)#` hacen falta dos `exit` y el equipo los ve (no se queda en `(config)#`)",
      r.salioDeConfig &&
        r.intentosSalida === 2 &&
        r.promptFinal === "R1#" &&
        (niveles.mock?.lines.filter((l) => l === "exit").length ?? 0) === 2,
      `intentosSalida=${r.intentosSalida} promptFinal=${JSON.stringify(r.promptFinal)} ` +
        `exits=${(niveles.mock?.lines ?? []).filter((l) => l === "exit").length}`,
      `intentosSalida=${r.intentosSalida} promptFinal=${JSON.stringify(r.promptFinal)} ` +
        `exits=${JSON.stringify(niveles.mock?.lines)}: ` +
        "`salirDeConfig` sube un nivel por envío: con uno solo la consola se queda en `(config)#`",
    );
  } finally {
    await niveles.cerrar();
  }


  const rechaza = await opciones.connect({
    escena: {
      prompt: "R1#",
      commands: {
        "configure terminal": { promptFinal: "R1(config)#" },

        exit: {
          lines: ["% Invalid input detected at '^' marker."],
          promptFinal: "R1(config)#",
        },
      },
    },
    typeDevice: "CISCO",
    prompt: "R1#",
    name: "config-exit-rechazado",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(rechaza.session, {
      commands: ["hostname R1-PROBA"],
      verifyCommands: ["show running-config"],
      ...CONFIG_CI,
    });
    const exits = (rechaza.mock?.lines ?? []).filter((l) => l === "exit").length;
    assert(
      "config: un comando de salida RECHAZADO por el equipo se escribe UNA vez, no se reintenta",
      r.motivoAborto === "salida_no_soportada" &&
        exits === 1 &&
        r.abortado &&
        r.salioDeConfig === false,
      `motivo=${r.motivoAborto} exits=${exits} abortado=${r.abortado} ` +
        `salioDeConfig=${r.salioDeConfig}`,
      `motivo=${r.motivoAborto} exits=${exits} abortado=${r.abortado}: ` +
        "el motor insiste con un comando que el equipo ya ha rechazado (le llena el equipo " +
        "de líneas de error idénticas sin que ninguna pueda funcionar)",
    );
    assert(
      "config: el motivo del aborto CITA lo que respondió el equipo",
      /Invalid input detected/.test(r.motivoAbortoTexto ?? "") &&
        (r.pasos ?? []).some((p) => p.fase === "salida" && /Invalid input detected/.test(p.detail ?? "")),
      `motivoAbortoTexto=${JSON.stringify(r.motivoAbortoTexto?.slice(0, 160))} ` +
        `paso=${JSON.stringify(r.pasos?.find((p) => p.fase === "salida")?.detail?.slice(0, 160))}`,
      `motivoAbortoTexto=${JSON.stringify(r.motivoAbortoTexto?.slice(0, 200))} ` +
        `paso=${JSON.stringify(r.pasos?.find((p) => p.fase === "salida")?.detail?.slice(0, 200))}: ` +
        "sin la frase literal del equipo nadie puede demostrar que el problema es el perfil " +
        "y no el motor",
    );
  } finally {
    await rechaza.cerrar();
  }
}




const RAIZ_ROUTEROS = "[admin@MikroTik] >";



async function caseMenuRouterOS(admin: AdminSuite, url: string, opciones: OpcionesSuite) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "menú de RouterOS: `..` por niveles y tope, raíz protegida");
    return;
  }

  
  const timesOfOutput = (lines: readonly string[] | undefined, command: string): number =>
    (lines ?? []).filter((l) => l === command).length;


  const unLevel = await opciones.connect({
    escena: {
      prompt: RAIZ_ROUTEROS,
      banner: ["  MikroTik RouterOS 6.49.13  ", "  Copyright 1999-2023 MikroTik"].join("\r\n"),
      commands: {
        "/system identity": { promptFinal: "[admin@MikroTik] /system identity>" },
        "set name=PT-PROBA": { lines: ["name: PT-PROBA"] },
        "/system identity print": { lines: ["name: PT-PROBA"], promptFinal: RAIZ_ROUTEROS },

        "..": {},
      },

      outputOfConfig: { command: "..", niveles: [RAIZ_ROUTEROS] },
    },
    typeDevice: "MIKROTIK",
    prompt: RAIZ_ROUTEROS,
    name: "routeros-menu-un-nivel",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(unLevel.session, {
      commands: ["/system identity", "set name=PT-PROBA"],
      verifyCommands: ["/system identity print"],
      ...CONFIG_CI,
    });
    assert(
      "RouterOS: el lote entra en un menú y el motor lo SACA con `..` (un nivel)",
      !r.abortado &&
        r.salioDeConfig &&
        r.intentosSalida === 1 &&
        timesOfOutput(unLevel.mock?.lines, "..") === 1 &&
        r.promptFinal === RAIZ_ROUTEROS &&
        r.modeFinal === "privilegiado",
      `salioDeConfig=${r.salioDeConfig} intentosSalida=${r.intentosSalida} ` +
        `promptFinal=${JSON.stringify(r.promptFinal)} modoFinal=${r.modeFinal} ` +
        `puntos=${timesOfOutput(unLevel.mock?.lines, "..")} ` +
        `escrito=${JSON.stringify(unLevel.mock?.lines)}`,
      `salioDeConfig=${r.salioDeConfig} intentosSalida=${r.intentosSalida} ` +
        `promptFinal=${JSON.stringify(r.promptFinal)} ` +
        `escrito=${JSON.stringify(unLevel.mock?.lines)}: ` +
        "el motor no sacó la consola del menú de RouterOS. MEDIDO en un MikroTik CHR " +
        "6.49.13 con el lote `[\"/system identity\", \"set name=…\"]`: el lote se " +
        "aplicaba y se verificaba bien, pero la consola se quedaba en " +
        "`[admin@MikroTik] /system identity>` y el motor respondía `salioDeConfig: false`",
    );
    assert(
      "RouterOS: con la consola ya en la raíz, la verificación se LEE (`/system identity print`)",
      r.verificacion?.completa === true &&
        (r.verificacion?.resultados[0]?.output ?? "").includes("name: PT-PROBA"),
      `verificacion=${JSON.stringify(r.verificacion?.resultados[0]?.output?.slice(0, 80))} ` +
        `completa=${r.verificacion?.completa}`,
      `verificacion=${JSON.stringify(r.verificacion)}: ` +
        "no se pudo releer lo aplicado (o se leyó desde dentro del menú, donde " +
        "`/system identity print` da `bad command name identity`)",
    );
  } finally {
    await unLevel.cerrar();
  }


  const anidado = await opciones.connect({
    escena: {
      prompt: RAIZ_ROUTEROS,
      commands: {
        "/interface bridge": { promptFinal: "[admin@MikroTik] /interface bridge>" },
        "add name=puente1": { lines: ["0 R name=puente1"] },
        "/interface bridge print": {
          lines: ["0 R name=puente1"],
          promptFinal: RAIZ_ROUTEROS,
        },
        "..": {},
      },

      outputOfConfig: {
        command: "..",
        niveles: ["[admin@MikroTik] /interface>", RAIZ_ROUTEROS],
      },
    },
    typeDevice: "MIKROTIK",
    prompt: RAIZ_ROUTEROS,
    name: "routeros-menu-anidado",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(anidado.session, {
      commands: ["/interface bridge", "add name=puente1"],
      verifyCommands: ["/interface bridge print"],
      ...CONFIG_CI,
    });
    assert(
      "RouterOS: de un menú ANIDADO hacen falta VARIOS `..` (uno por nivel, con tope)",
      !r.abortado &&
        r.salioDeConfig &&
        r.intentosSalida === 2 &&
        r.intentosSalida <= 4 &&
        timesOfOutput(anidado.mock?.lines, "..") === 2 &&
        r.promptFinal === RAIZ_ROUTEROS,
      `salioDeConfig=${r.salioDeConfig} intentosSalida=${r.intentosSalida} ` +
        `puntos=${timesOfOutput(anidado.mock?.lines, "..")} ` +
        `promptFinal=${JSON.stringify(r.promptFinal)} ` +
        `escrito=${JSON.stringify(anidado.mock?.lines)}`,
      `salioDeConfig=${r.salioDeConfig} intentosSalida=${r.intentosSalida} ` +
        `escrito=${JSON.stringify(anidado.mock?.lines)}: ` +
        "`salirDeConfig` sube UN nivel por envío (como `exit` en IOS): con uno solo la " +
        "consola se queda en `[admin@MikroTik] /interface>`",
    );
    assert(
      "RouterOS: los `..` del menú NO tocan la verificación (esa va con la consola ya fuera)",
      r.verificacion?.completa === true &&
        (anidado.mock?.lines ?? []).filter((l) => l === "/interface bridge print")
          .length === 1,
      `completa=${r.verificacion?.completa} ` +
        `verificaciones=${timesOfOutput(anidado.mock?.lines, "/interface bridge print")}`,
      `verificacion=${JSON.stringify(r.verificacion?.reason)}: ` +
        "la verificación se ejecutó antes de salir del menú (o más de una vez)",
    );
  } finally {
    await anidado.cerrar();
  }


  const raiz = await opciones.connect({
    escena: {
      prompt: RAIZ_ROUTEROS,
      commands: {
        "/interface print": { lines: ["0 R name=ether1"], promptFinal: RAIZ_ROUTEROS },
        "..": {},
      },
      outputOfConfig: { command: "..", niveles: [RAIZ_ROUTEROS] },
    },
    typeDevice: "MIKROTIK",
    prompt: RAIZ_ROUTEROS,
    name: "routeros-raiz-protegida",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(raiz.session, {
      commands: ["/interface print"],
      verifyCommands: ["/interface print"],
      ...CONFIG_CI,
    });
    assert(
      "RouterOS: en la RAÍZ no se escribe NINGÚN `..` (el criterio es 'estoy en un menú')",
      (raiz.mock?.lines ?? []).filter((l) => l === "..").length === 0 &&
        r.salioDeConfig &&
        r.intentosSalida === 0 &&
        r.abortado === false,
      `puntos=${timesOfOutput(raiz.mock?.lines, "..")} salioDeConfig=${r.salioDeConfig} ` +
        `intentosSalida=${r.intentosSalida} escrito=${JSON.stringify(raiz.mock?.lines)}`,
      `puntos=${timesOfOutput(raiz.mock?.lines, "..")} ` +
        `escrito=${JSON.stringify(raiz.mock?.lines)}: el motor escribió la subida de ` +
        "nivel en la raíz, que es justo lo que la guarda tiene que impedir",
    );
    assert(
      "RouterOS: la línea de salida omitida explica POR QUÉ no se escribió",
      (r.pasos ?? []).some(
        (p) => p.fase === "salida" && p.status === "omitido" && /no es un sub-modo/.test(p.detail ?? ""),
      ),
      `pasos=${JSON.stringify(r.pasos?.map((p) => ({ c: p.command, e: p.status })))}`,
      `pasos=${JSON.stringify(r.pasos)}: la omisión de la salida tiene que quedar ` +
        "diagnosticada en el payload, no ser silenciosa",
    );
  } finally {
    await raiz.cerrar();
  }


  const perdido = await opciones.connect({
    escena: {
      prompt: RAIZ_ROUTEROS,
      commands: {
        "/system identity": { promptFinal: "[admin@MikroTik] /system identity>" },
        "set name=PT-PROBA": { lines: ["name: PT-PROBA"] },

        "..": { teclasPerdidas: 1 },
      },
      outputOfConfig: { command: "..", niveles: [RAIZ_ROUTEROS] },
    },
    typeDevice: "MIKROTIK",
    prompt: RAIZ_ROUTEROS,
    name: "routeros-punto-perdido",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(perdido.session, {
      commands: ["/system identity", "set name=PT-PROBA"],
      ...CONFIG_CI,
    });
    assert(
      "RouterOS: un `..` que el equipo se traga la primera vez sale al reintento",
      !r.abortado &&
        r.salioDeConfig &&
        r.intentosSalida === 2 &&
        timesOfOutput(perdido.mock?.lines, "..") === 2 &&
        r.promptFinal === RAIZ_ROUTEROS,
      `salioDeConfig=${r.salioDeConfig} intentosSalida=${r.intentosSalida} ` +
        `puntos=${timesOfOutput(perdido.mock?.lines, "..")} ` +
        `promptFinal=${JSON.stringify(r.promptFinal)}`,
      `salioDeConfig=${r.salioDeConfig} intentosSalida=${r.intentosSalida} ` +
        `escrito=${JSON.stringify(perdido.mock?.lines)}: el motor no reintentó la ` +
        "subida de nivel (o la dio por buena sin comprobar que el prompt cambió)",
    );
  } finally {
    await perdido.cerrar();
  }
}



async function caseConfigSerie(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "ciclo de configuración por serie (eol del perfil)");
    return;
  }
  const mockConsole = await opciones.connect({
    escena: {
      prompt: "R1>",

      commands: {
        enable: { promptFinal: "R1#" },
        "configure terminal": { promptFinal: "R1(config)#" },
        exit: { promptFinal: "R1#" },
        "show ip interface brief": { lines: ["GigabitEthernet0/1 10.0.0.1 up up"] },
      },
    },
    typeDevice: "CISCO",
    prompt: "R1>",
    name: "config-serie",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(mockConsole.session, {
      commands: ["interface GigabitEthernet0/1"],
      verifyCommands: ["show ip interface brief"],
      ...CONFIG_CI,
    });
    const raw = mockConsole.mock?.raw ?? "";
    const cr = (raw.match(/\r/g) ?? []).length;
    const lf = (raw.match(/\n/g) ?? []).length;
    assert(
      "config serie: cada línea se cierra con \\r (el eol del perfil), no con \\r\\n ni \\n",
      raw.length > 0 && cr > 0 && lf === 0,
      `${cr} \\r y ${lf} \\n en ${raw.length} chars escritos`,
      `el motor escribió ${JSON.stringify(raw.slice(0, 120))}: en serie el EOL es el del ` +
        "perfil (`\\r`) y no el del transporte",
    );
    assert(
      "config serie: el ciclo funciona sin login ni banner previo",
      !r.abortado && r.entramosEnConfig && r.verificacion?.completa === true,
      `abortado=${r.abortado} entramosEnConfig=${r.entramosEnConfig} ` +
        `modoFinal=${r.modeFinal} verificacion=${r.verificacion?.completa}`,
      `abortado=${r.abortado} motivo=${r.motivoAborto} entramosEnConfig=${r.entramosEnConfig} ` +
        `modoFinal=${r.modeFinal}: la consola de serie no dio prompt y el motor no puede trabajar`,
    );
  } finally {
    await mockConsole.cerrar();
  }
}



async function caseConfigureDeviceTool(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "tool configure_device (payload para el modelo)");
    return;
  }

  const escena = (): EscenaMockConsole => ({
    prompt: "R1>",
    commands: {
      enable: { promptFinal: "R1#" },
      "configure terminal": { promptFinal: "R1(config)#" },
      exit: { promptFinal: "R1#" },
      "show ip interface brief": { lines: ["GigabitEthernet0/1 10.0.0.1 up up"] },
    },
    dialogos: {
      "write memory": {
        question: "Destination filename [startup-config]?",
        wait: "",
        output: "[OK]",
      },
    },
  });


  const plan = await opciones.connect({
    escena: escena(),
    typeDevice: "CISCO",
    prompt: "R1>",
    name: "config-tool-dryrun",
  });
  try {
    const output = JSON.parse(
      await toolByName("configure_device").invoke({
        commands: ["interface GigabitEthernet0/1", "no shutdown"],
        save: true,
        dryRun: true,
      }),
    );
    assert(
      "configure_device: dryRun devuelve el plan y no escribe NADA",
      output.success === true &&
        output.dryRun === true &&
        output.escrito === false &&
        (plan.mock?.raw ?? "") === "" &&
        (plan.mock?.lines.length ?? 0) === 0,
      `escrito=${output.escrito} plan=${JSON.stringify(output.plan.lines.map((l: any) => l.command))} ` +
        `equipo vio=${JSON.stringify(plan.mock?.lines)}`,
      `dryRun=${output.dryRun} escrito=${output.escrito} ` +
        `equipo vio=${JSON.stringify(plan.mock?.lines)}: un dryRun que escribe un byte ` +
        "es peor que no tener dryRun",
    );
    assert(
      "configure_device: el plan incluye preámbulo, modo, líneas y guardado",
      JSON.stringify(output.plan.lines.map((l: any) => l.command)) ===
        JSON.stringify([
          "terminal length 0",
          "no ip domain-lookup",
          "enable",
          "configure terminal",
          "interface GigabitEthernet0/1",
          "no shutdown",
          "write memory",
          "exit",
        ]),
      `plan=${JSON.stringify(output.plan.lines.map((l: any) => l.command))}`,
      `plan=${JSON.stringify(output.plan.lines.map((l: any) => l.command))}`,
    );
  } finally {
    await plan.cerrar();
  }


  const real = await opciones.connect({
    escena: escena(),
    typeDevice: "CISCO",
    prompt: "R1>",
    name: "config-tool-real",
  });
  try {
    const output = JSON.parse(
      await toolByName("configure_device").invoke({
        commands: ["interface GigabitEthernet0/1", "no shutdown"],
        save: true,
        verifyCommands: ["show ip interface brief"],
        timeoutMs: 8_000,
      }),
    );
    const statuses = (output.pasos ?? []).map((p: any) => `${p.fase}:${p.command}:${p.status}`);
    assert(
      "configure_device: devuelve el estado real de cada línea y el vendor",
      output.success === true &&
        output.vendor === "cisco" &&
        output.modeFinal === "privilegiado" &&

        statuses.length > 0 &&
        statuses.every(
          (e: string) => e.endsWith(":enviado") || e.endsWith(":dialogo"),
        ),
      `success=${output.success} vendor=${output.vendor} modoFinal=${output.modeFinal} ` +
        `estados=${JSON.stringify(statuses)}`,
      `success=${output.success} vendor=${output.vendor} modoFinal=${output.modeFinal} ` +
        `estados=${JSON.stringify(statuses)} message=${output.message}`,
    );
    assert(
      "configure_device: el diálogo legítimo se contestó con Enter y sale diagnosticado",
      Array.isArray(output.dialogos) &&
        output.dialogos.length === 1 &&
        output.dialogos[0].tipo === "confirmacion_propia" &&
        output.dialogos[0].reply === "",
      `dialogos=${JSON.stringify(output.dialogos)}`,
      `dialogos=${JSON.stringify(output.dialogos)}: el modelo no puede saber si el equipo ` +
        "preguntó algo y qué se respondió",
    );
    assert(
      "configure_device: la verificación viene leída del equipo",
      output.verificacion?.completa === true &&
        output.verificacion.resultados[0].output.includes("10.0.0.1"),
      `verificacion=${JSON.stringify(output.verificacion)}`,
      `verificacion=${JSON.stringify(output.verificacion)}`,
    );
    assert(
      "configure_device: el equipo vio el ciclo completo y solo eso",
      (real.mock?.lines.join(" | ") ?? "") ===
        "terminal length 0 | no ip domain-lookup | enable | configure terminal | " +
          "interface GigabitEthernet0/1 | no shutdown | write memory | exit | " +
          "show ip interface brief",
      `el equipo vio ${JSON.stringify(real.mock?.lines)}`,
      `el equipo vio ${JSON.stringify(real.mock?.lines)}`,
    );
  } finally {
    await real.cerrar();
  }


  const vrp = await opciones.connect({
    escena: {
      prompt: "<Huawei>",
      commands: {
        "system-view": { promptFinal: "[Huawei]" },
        quit: { promptFinal: "<Huawei>" },
      },
      dialogos: {
        save: {
          question:
            "The current configuration will be written to the device.\r\nAre you sure to continue?[Y/N]:",
          wait: "y",
        },
      },
    },
    typeDevice: "HUAWEI",
    prompt: "<Huawei>",
    name: "config-tool-vrp",
  });
  try {
    const output = JSON.parse(
      await toolByName("configure_device").invoke({
        commands: ["interface GigabitEthernet0/0/0", "undo shutdown"],
        save: true,
        timeoutMs: 6_000,
      }),
    );
    assert(
      "configure_device (Huawei): el diálogo [Y/N] vuelve al modelo y success es false",
      output.success === false &&
        output.code === "DIALOGO_PENDIENTE" &&
        output.vendor === "huawei" &&
        /Are you sure to continue/.test(output.dialogoPendiente?.text ?? "") &&
        (vrp.mock?.dialogos[0]?.recibida ?? null) === null,
      `code=${output.code} vendor=${output.vendor} ` +
        `dialogoPendiente=${JSON.stringify(output.dialogoPendiente?.text?.slice(-40))} ` +
        `recibida=${JSON.stringify(vrp.mock?.dialogos[0]?.recibida)}`,
      `code=${output.code} vendor=${output.vendor} ` +
        `dialogoPendiente=${JSON.stringify(output.dialogoPendiente)} ` +
        `recibida=${JSON.stringify(vrp.mock?.dialogos[0]?.recibida)}: la tool va a reportar ` +
        "un diálogo al usuario como si fuera un éxito, o lo contestó por su cuenta",
    );
  } finally {
    await vrp.cerrar();
  }


  const muerto = await opciones.connect({
    escena: { prompt: null, retardoSaludoMs: 0 },
    typeDevice: "CISCO",
    prompt: null,
    name: "config-tool-sin-prompt",
  });
  try {
    const output = JSON.parse(
      await toolByName("configure_device").invoke({
        commands: ["interface GigabitEthernet0/1"],
        timeoutMs: 1_200,
      }),
    );
    assert(
      "configure_device: sin prompt no escribe nada y dice que puede estar apagado",
      output.success === false &&
        output.code === "TERMINAL_NOT_RESPONDING" &&
        /apagado/i.test(output.message) &&
        (muerto.mock?.raw ?? "") === "",
      `code=${output.code} message=${String(output.message).slice(0, 160)} ` +
        `escrito=${JSON.stringify(muerto.mock?.raw)}`,
      `code=${output.code} message=${String(output.message).slice(0, 160)} ` +
        `escrito=${JSON.stringify(muerto.mock?.raw)}`,
    );
  } finally {
    await muerto.cerrar();
  }
}



async function caseConfigPaginator(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  if (!sePuede(opciones)) {
    skipSimulados(opciones, "el motor de configuración paga el paginador");
    return;
  }
  const mockConsole = await opciones.connect({
    escena: {
      prompt: "R1#",
      commands: {
        "configure terminal": { promptFinal: "R1(config)#" },
        exit: { promptFinal: "R1#" },

        "banner motd": {
          pages: 3,
          variant: "--More--",
          prefix: "cfg",
        },
      },
    },
    typeDevice: "CISCO",
    prompt: "R1#",
    name: "config-paginador",
  });
  try {
    const r = await terminalSessionHub.runConfigDetailed(mockConsole.session, {
      commands: ["banner motd"],
      ...CONFIG_CI,
    });
    const paso = r.pasos.find((p) => p.command === "banner motd");
    assert(
      "config: el motor paga las páginas del comando y la salida del paso llega completa",
      paso?.paged === true && paso?.pages === 2 && paso.output.includes("cfg-FINAL-p3"),
      `paged=${paso?.paged} pages=${paso?.pages} output=${JSON.stringify(paso?.output?.slice(-80))}`,
      `paged=${paso?.paged} pages=${paso?.pages} output=${JSON.stringify(paso?.output?.slice(-120))}: ` +
        "la salida del comando de configuración quedó a medias por el paginador",
    );
    assert(
      "config: el paginador se paga con la tecla correcta y el equipo solo ve el comando",
      mockConsole.mock?.teclasPaginator === 2 &&
        (mockConsole.mock?.lines.join(" | ") ?? "") ===
          "terminal length 0 | no ip domain-lookup | configure terminal | banner motd | exit",
      `teclasPaginador=${mockConsole.mock?.teclasPaginator} ` +
        `escrito=${JSON.stringify(mockConsole.mock?.lines)}`,
      `teclasPaginador=${mockConsole.mock?.teclasPaginator} ` +
        `escrito=${JSON.stringify(mockConsole.mock?.lines)}`,
    );
  } finally {
    await mockConsole.cerrar();
  }
}



async function caseCommandEnTeamReal(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
) {
  const command = opciones.command ?? "show clock";
  const mockConsole = await opciones.connect({ escena: { prompt: null }, name: opciones.name });
  try {
    const snapshot = await waitPrompt(mockConsole.session, 20_000, opciones.prompt);
    assert(
      "equipo real: la consola entrega un prompt",
      Boolean(snapshot.prompt) && snapshot.promptWaitMessage === null,
      `prompt="${snapshot.prompt}" vendor=${snapshot.vendor}`,
      `la consola no dio un prompt${opciones.prompt ? ` esperado "${opciones.prompt}"` : ""}: ` +
        (snapshot.promptWaitMessage ?? `prompt detectado=${JSON.stringify(snapshot.prompt)}`),
    );

    const r: TerminalCommandResult = await terminalSessionHub.sendCommandDetailed(
      mockConsole.session,
      command,
      { idleMs: 3_000, maxMs: 45_000 },
    );
    assert(
      "equipo real: el comando de solo lectura devuelve salida",
      r.executed.includes(command) && r.output.trim().length > 0,
      `endReason=${r.endReason} timedOut=${r.timedOut} elapsedMs=${r.elapsedMs} ` +
        `output=${JSON.stringify(r.output.slice(0, 180))}`,
      `executed=${JSON.stringify(r.executed)} output=${JSON.stringify(r.output.slice(0, 180))} ` +
        `endReason=${r.endReason} timedOut=${r.timedOut}: el comando no devolvió nada`,
    );
    assert(
      "equipo real: la captura terminó por un motivo coherente",
      r.endReason !== "dead",
      `endReason=${r.endReason}${r.paged ? ` (paginada, ${r.pages} páginas de ${r.pagerVariant})` : ""}`,
      `endReason=${r.endReason} pendingInput=${JSON.stringify(r.pendingInput)}: la sesión se cayó`,
    );
    assert(
      "equipo real: la salida no quedó a medias por paginador",
      !r.paged || r.endReason !== "pending",
      r.paged
        ? `se paginaron ${r.pages} páginas y la salida llegó al final`
        : "el equipo no pagina la salida",
      `el equipo pagina y el paginador dejó de responder (endReason=pending, ${r.pages} páginas): ` +
        "la salida puede estar incompleta",
    );
  } finally {
    await mockConsole.cerrar();
  }
}




export async function runSuite(
  admin: AdminSuite,
  url: string,
  opciones: OpcionesSuite,
): Promise<void> {
  await comoAdmin(admin, async () => {
    await caseEnv(url, admin);
    await casePaginator(admin, url, opciones);
    await casePaginatorColgado(admin, url, opciones);
    await caseVariantsPaginator(admin, url, opciones);
    await casePromptParcial(admin, url, opciones);
    await caseTableOfVendors(admin, url, opciones);
    if (sePuede(opciones)) await casePreFlightWithoutPrompt(admin, url, opciones);
    else await caseVendorEnTeamReal(admin, url, opciones);
    await caseRuidoOfMockConsole(admin, url, opciones);
    await caseNoCerrarSession(admin, url, opciones);
    await caseOutputLong(admin, url, opciones);
    await caseLogin(admin, url, opciones);
    await caseEchoOfCommand(admin, url, opciones);
    await caseWakeMockConsole(admin, url, opciones);
    await caseNeutralityMarkers(admin, url, opciones);
    await caseConfigByMarker(admin, url, opciones);
    await caseConfigSerie(admin, url, opciones);
    await caseSalirOfConfigComprobado(admin, url, opciones);
    await caseMenuRouterOS(admin, url, opciones);
    await caseConfigPaginator(admin, url, opciones);
    await caseConfigureDeviceTool(admin, url, opciones);
    if (!sePuede(opciones)) await caseCommandEnTeamReal(admin, url, opciones);
  });
}




function typeDeviceOf(caso: string | null | undefined, byDefecto: string | null): string | null {
  return caso === undefined ? byDefecto : caso;
}


export function conectorMock(
  admin: AdminSuite,
  url: string,
  base: { protocolo?: Transport; kindDevice?: string | null; name?: string } = {},
): ConnectMockConsole {
  return async (requested) => {
    const mockConsole: MockConsoleFake = await createMockConsoleFake(requested.escena);
    const payload: PayloadConnection = {
      type: base.protocolo ?? "TELNET",
      host: "127.0.0.1",
      port: mockConsole.port,
      typeDevice: typeDeviceOf(requested.typeDevice, base.kindDevice ?? "CISCO"),
      name: requested.name ?? base.name ?? "consola-falsa",
    };
    try {
      const connection = await connectMockConsole(url, admin.token, payload);
      const prompt = requested.prompt === undefined ? requested.escena.prompt : requested.prompt;
      if (prompt !== null) {
        await waitPrompt(connection.session, 5_000, prompt);
      }

      await waitConnections(mockConsole, 1);
      return {
        sessionId: connection.sessionId,
        session: connection.session,
        mock: mockConsole.connections[0] ?? null,
        cerrar: async () => {
          await connection.cerrar();
          await mockConsole.cerrar();
        },
      };
    } catch (error) {
      await mockConsole.cerrar();
      throw error;
    }
  };
}


export function conectorReal(
  admin: AdminSuite,
  url: string,
  opciones: Omit<OpcionesSuite, "conectar" | "simulado" | "etiqueta">,
): ConnectMockConsole {
  return async (requested) => {
    const payload: PayloadConnection = {
      type: opciones.protocolo,
      typeDevice: typeDeviceOf(requested.typeDevice, opciones.kindDevice ?? null),
      name: requested.name ?? opciones.name ?? "equipo-real",
    };
    if (opciones.protocolo === "SERIAL") {
      payload.serialPort = opciones.serialPort;
      payload.baudRate = opciones.baudRate ?? 9600;
    } else {
      payload.host = opciones.host;
      payload.port = opciones.port;
      payload.username = opciones.username;
      payload.password = opciones.password;
    }
    const connection = await connectMockConsole(url, admin.token, payload, 40_000);
    return {
      sessionId: connection.sessionId,
      session: connection.session,
      mock: null,
      cerrar: connection.cerrar,
    };
  };
}


export async function runSuiteMock(
  admin: AdminSuite,
  url: string,
  extra: { protocolo?: Transport; name?: string } = {},
): Promise<void> {
  await runSuite(admin, url, {
    protocolo: extra.protocolo ?? "TELNET",
    host: "127.0.0.1",
    connect: conectorMock(admin, url, extra),
    etiqueta: "consola simulada (servidorFalso.ts)",
    mock: true,
    name: extra.name,
  });
}
