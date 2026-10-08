

import { AIMessage } from "@langchain/core/messages";
import { vi } from "vitest";
import { ciscoClient } from "@/client/PacketTracerClient";
import { PREFIJO_LLAMADA_DUPLICADA, indicaFallo } from "@/agent/deep/duplicateGuardMiddleware";
import { PREFIJO_REINTENTO_BLOQUEADO } from "@/agent/deep/retryGuardMiddleware";
import { APPROVAL_MESSAGE_PREFIXES } from "@/agent/approval/ApprovalMiddleware";
import { clasificarToolMessage } from "@/agent/security/ToolErrorClassifier";
import { LOAD_TOOLS_NAME, PT_TOOLS_EAGER } from "@/agent/tools/lazyTools";


const MARKER_TAIL_TERMINAL = "--- Última salida de terminal ---";
import {
  MARKER_TAIL,
  TAIL_RAW_EVAL,
  runTurn,
  type MeasurementTurn,
} from "./harness";
import type { Script } from "./modeloFalso";


export interface Check {
  
  name: string;
  
  threshold: string;
  
  value: string;
  
  ok: boolean;
  
  detail?: string;
}


export interface ResultScenario {
  id: string;
  title: string;
  byThat: string;
  passes: boolean;
  measurement: MeasurementTurn;
  checks: Check[];
  notas: string[];
}

export interface Scenario {
  id: string;
  title: string;
  
  byThat: string;
  run: () => Promise<MeasurementTurn>;
  comprobar: (measurement: MeasurementTurn) => Check[];
  notas?: string[];
}






function max(name: string, measured: number, threshold: number, detail?: string): Check {
  return {
    name,
    threshold: `≤ ${threshold}`,
    value: String(measured),
    ok: measured <= threshold,
    ...(detail ? { detail } : {}),
  };
}


function min(name: string, measured: number, threshold: number, detail?: string): Check {
  return {
    name,
    threshold: `≥ ${threshold}`,
    value: String(measured),
    ok: measured >= threshold,
    ...(detail ? { detail } : {}),
  };
}


function exact(name: string, measured: number, esperado: number, detail?: string): Check {
  return {
    name,
    threshold: `= ${esperado}`,
    value: String(measured),
    ok: measured === esperado,
    ...(detail ? { detail } : {}),
  };
}


function contract(name: string, ok: boolean, value: string, detail?: string): Check {
  return { name, threshold: ok ? "sí" : "no", value, ok, ...(detail ? { detail } : {}) };
}


function roundsWithBlock(measurement: MeasurementTurn, prefix: string): number {
  return measurement.modelcalls.filter((call) => call.lastResult.includes(prefix)).length;
}


function roundsOf(measurement: MeasurementTurn, node: string): number {
  return measurement.modelcalls.filter((call) => call.node === node).length;
}


function toolsOfRound(measurement: MeasurementTurn, node: string, index: number): string[] {
  return measurement.modelcalls.filter((call) => call.node === node)[index]?.tools ?? [];
}


function toolCall(name: string, args: Record<string, unknown>, id: string): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ name, args, id, type: "tool_call" }],
  });
}


function delegate(subagent: string, description: string, id: string): AIMessage {
  return toolCall("task", { description, subagent_type: subagent }, id);
}




const SCRIPT_QUERY_SIMPLE: Script = ({ node, round }) => {
  if (node === "supervisor") {
    if (round === 1) {
      return delegate(
        "ssh_specialist",
        "Dime el modelo y la versión del sistema del R1-core. Consola SSH viva (R1#), vendor CISCO. Una sola lectura.",
        "task-consulta-1",
      );
    }
    return new AIMessage({
      content: "El R1-core corre Cisco IOS XE Software, Version 16.12.4 y lleva 4 días encendido.",
    });
  }
  if (round === 1) return toolCall("send_command", { command: "show version" }, "cmd-consulta-1");
  return new AIMessage({
    content: "Modelo: Cisco IOS XE. Versión 16.12.4. Uptime 4 días.",
  });
};

export const scenarioQuerySimple: Scenario = {
  id: "consulta-simple-consola",
  title: "Consulta simple con consola conectada (configuración actual: fast path OFF)",
  byThat:
    "Métrica objetivo del plan: ≤3 llamadas LLM en una consulta simple y cero volcado de consola con el default (D2). Se mide con lo que se envía hoy (FAST_PATH_ENABLED apagado) y con el cliente ENVIANDO la cola: con el selector en 0, ni una línea debe entrar en el turno.",
  async run() {
    const { measurement } = await runTurn({
      prompt: "quiero saber el modelo del sistema",
      script: SCRIPT_QUERY_SIMPLE,
      modelProviderId: "eval-consulta-simple",
      fastPath: false,

      terminalTail: TAIL_RAW_EVAL,
      terminalContextLines: 0,
    });
    return measurement;
  },
  comprobar(measurement) {
    const first = measurement.modelcalls.find((call) => call.node === "supervisor");
    return [
      max(
        "llm.calls",
        measurement.calls,
        4,
        "objetivo del plan ≤3 con FAST_PATH_ENABLED: aquí se mide con la flag APAGADA (la configuración que se envía hoy), así que 4 es lo correcto. Con la flag encendida son 2 (ver `hallazgo-puerta-fast-path`)",
      ),
      exact("llm.calls supervisor", roundsOf(measurement, "supervisor"), 2),
      exact("llm.calls especialista", roundsOf(measurement, "ssh_specialist"), 2),
      exact("delegaciones task", measurement.delegations, 1),
      max(
        "input_tokens supervisor (1ª llamada)",
        first?.tokensInput ?? 0,
        7000,
        "el objetivo «<4k» del plan se midió con la estimación de 120 tok/tool; con los schemas REALES son 6.5k. Lo que se vigila aquí es que no crezca",
      ),
      max(
        "input_tokens: schemas de tools del supervisor",
        first?.tokensTools ?? 0,
        5600,
        "11 tools reales (incluye `task`, que lleva las 8 descripciones de sub-agentes). BASELINE §Fase 4 medía 1440 con la estimación de 120 tok/tool: con schemas reales son 5.4k",
      ),
      exact("cola: líneas en el system prompt", measurement.mockConsole.linesEnSystemPrompt, 0),
      exact(
        "cola: líneas del cliente que llegan al modelo",
        measurement.mockConsole.linesTailEnModel,
        0,
        "el cliente envía la cola y el selector está en 0: no debe entrar",
      ),
      contract(
        "cola: marca del buffer ausente del prompt",
        !measurement.mockConsole.markerEnSystemPrompt,
        measurement.mockConsole.markerEnSystemPrompt ? "PRESENTE" : "ausente",
        "si aparece, el volcado volvió al prompt compilado (V1/V3)",
      ),
      contract(
        "encabezado mínimo de terminal presente",
        measurement.mockConsole.hasHeaderMin,
        measurement.mockConsole.hasHeaderMin ? "presente" : "ausente",
      ),
      contract(
        "respuesta con el modelo del sistema",
        /IOS XE/i.test(measurement.reply),
        `${measurement.reply.slice(0, 48)}…`,
      ),
    ];
  },
  notas: [
    "Con FAST_PATH_ENABLED apagado (lo que se envía hoy) la consulta cuesta 4 invocaciones: 2 rondas de supervisor + 2 del especialista. Con la flag encendida son 2 (`hallazgo-puerta-fast-path` y `fastpath-conservador`): el objetivo ≤3 se cumple, pero activar la flag sigue siendo la decisión de la fase posterior (D3).",
  ],
};





function installBridgePacketTracerFake(): void {
  vi.spyOn(ciscoClient, "callTool").mockImplementation(
    async (tool: string, input: unknown) => {
      switch (tool) {
        case "getNetwork":
          return { success: true, devices: [{ name: "R1", model: "Router-PT" }], links: [] };
        case "getDeviceConfig":

        case "getDeviceConfigSnapshot":
          return {
            success: true,
            deviceName: String((input as { deviceName?: string })?.deviceName ?? "R1"),
            running: "hostname R1",
          };
        case "getRoutingTable":
          return { success: true, routes: [{ prefix: "10.0.0.0/24", nextHop: "R1" }] };
        default:
          throw new Error(`El eval no guionó la herramienta de Packet Tracer '${tool}'`);
      }
    },
  );
}


const SCRIPT_DELEGATION_PT: Script = ({ node, round }) => {
  if (node === "supervisor") {
    if (round === 1) {
      return delegate(
        "packet_tracer_specialist",
        "Lee el estado actual del workspace de Packet Tracer y devuélvelo con las rutas aprendidas de R1.",
        "task-pt-1",
      );
    }
    return new AIMessage({
      content: "En Packet Tracer, R1 tiene aprendida la ruta 10.0.0.0/24 y la topología es válida.",
    });
  }
  switch (round) {
    case 1:
      return toolCall("getNetwork", {}, "pt-getnetwork");
    case 2:

      return toolCall(LOAD_TOOLS_NAME, { tools: ["getDeviceConfig"] }, "pt-load-1");
    case 3:
      return toolCall("getDeviceConfig", { deviceName: "R1" }, "pt-config-1");
    case 4:
      return toolCall("getRoutingTable", { deviceName: "R1" }, "pt-routes-1");
    default:
      return new AIMessage({ content: "Topología leída: R1 con 10.0.0.0/24 aprendido." });
  }
};

export const scenarioDelegationPt: Scenario = {
  id: "delegacion-pt",
  title: "Tarea de Packet Tracer (~8 llamadas): tools bajo demanda con AGENT_LAZY_TOOLS",
  byThat:
    "Criterio del plan tras la Fase 4: el especialista de Packet Tracer ve ≤8 tools por llamada con AGENT_LAZY_TOOLS, y es load_tools lo que amplía el conjunto. Se mide sobre las tools REALES ligadas en cada ronda (después de lazyToolsMiddleware), no sobre el registro declarado.",
  async run() {
    try {
      installBridgePacketTracerFake();
      const { measurement } = await runTurn({
        prompt: "mira qué hay ahora mismo en Packet Tracer y dime las rutas de R1",
        script: SCRIPT_DELEGATION_PT,
        modelProviderId: "eval-delegacion-pt",

        connection: null,
        origin: "chat",
      });
      return measurement;
    } finally {
      vi.restoreAllMocks();
    }
  },
  comprobar(measurement) {
    const roundsPt = measurement.modelcalls.filter(
      (call) => call.node === "packet_tracer_specialist",
    );
    const first = toolsOfRound(measurement, "packet_tracer_specialist", 0);
    const beforeOfLoad = roundsPt[1]?.tools ?? [];
    const afterOfLoad = roundsPt[2]?.tools ?? [];
    const maxLigadas = roundsPt.reduce((greater, l) => Math.max(greater, l.tools.length), 0);

    const withoutResolveByDefecto = first.filter((t) => t !== LOAD_TOOLS_NAME).length;
    const loaded = afterOfLoad.filter((tool) => !first.includes(tool));

    return [
      min(
        "llm.calls (turno PT)",
        measurement.calls,
        7,
        "2 rondas del supervisor + 5 del especialista; el plan hablaba de «~8»",
      ),
      exact("delegaciones task", measurement.delegations, 1),
      max(
        "1ª ronda: tools ligadas",
        first.length,
        PT_TOOLS_EAGER.length + 1,
        "núcleo (≤8) + load_tools",
      ),
      max(
        "criterio «≤8»: tools sin resolver por defecto",
        withoutResolveByDefecto,
        PT_TOOLS_EAGER.length,
        "el subconjunto eager que se liga sin pedir nada",
      ),
      max(
        "tools ligadas en cualquier ronda",
        maxLigadas,
        PT_TOOLS_EAGER.length + 2,
        "núcleo + resolutora + 1 tool cargada",
      ),
      contract(
        "1ª ronda: el núcleo no trae diferidas",
        !first.includes("getDeviceConfig") && !first.includes("addDevice"),
        `${first.filter((t) => t !== LOAD_TOOLS_NAME).length} sin resolver + ${LOAD_TOOLS_NAME}`,
      ),
      contract("1ª ronda incluye load_tools", first.includes(LOAD_TOOLS_NAME), "sí"),
      contract(
        "antes de load_tools la diferida no está",
        !beforeOfLoad.includes("getDeviceConfig"),
        "ausente",
      ),
      contract(
        "después de load_tools la diferida sí está",
        afterOfLoad.includes("getDeviceConfig"),
        "visible",
        "load_tools es lo que amplía el conjunto",
      ),
      exact(
        "tools que `load_tools` añadió al conjunto",
        loaded.length,
        1,
        `añadidas: ${loaded.join(", ") || "(ninguna)"}`,
      ),
    ];
  },
};




const SCRIPT_ERROR_FINAL: Script = ({ node, round, lastResult }) => {
  if (node === "supervisor") {
    if (round === 1) {
      return delegate(
        "ssh_specialist",
        "Ejecuta 'show bogus' en el R1-core (SSH viva, R1#, CISCO) y dime qué devuelve.",
        "task-def-1",
      );
    }
    return new AIMessage({
      content: lastResult.includes(PREFIJO_REINTENTO_BLOQUEADO)
        ? "No lo he repetido: el equipo rechaza ese comando (entrada inválida). Necesito el comando correcto."
        : "El equipo rechazó el comando.",
    });
  }

  if (round <= 2) return toolCall("send_command", { command: "show bogus" }, `cmd-def-${round}`);
  return new AIMessage({ content: "No se pudo ejecutar: el CLI rechaza la línea." });
};

export const scenarioToolFailureFinal: Scenario = {
  id: "tool-falla-definitivo",
  title: "Error definitivo de tool: no se reintenta y la respuesta lo dice",
  byThat:
    "Fase 4/Q4: una tool que falla con error DEFINITIVO (% Invalid input detected) no puede dar un resultado distinto si se repite. retryGuardMiddleware debe cortarla y el turno debe cerrar explicando el bloqueo en vez de quemar el presupuesto.",
  async run() {
    const { measurement } = await runTurn({
      prompt: "ejecuta show bogus en el switch y dime qué pasa",
      script: SCRIPT_ERROR_FINAL,
      modelProviderId: "eval-error-definitivo",
    });
    return measurement;
  },
  comprobar(measurement) {
    const ejecuciones = measurement.writes["show bogus"] ?? 0;
    const blocks = roundsWithBlock(measurement, PREFIJO_REINTENTO_BLOQUEADO);
    return [
      exact(
        "ejecuciones reales de `show bogus`",
        ejecuciones,
        1,
        "una sola escritura en la consola: el reintento no llegó al dispositivo",
      ),
      min("bloqueos [REINTENTO_BLOQUEADO] vistos por el modelo", blocks, 1),
      contract(
        "la respuesta dice que no se reintentó",
        /no lo he repetido|no se pudo ejecutar|rechaza/i.test(measurement.reply),
        `${measurement.reply.slice(0, 48)}…`,
      ),
      max("llm.calls", measurement.calls, 6, "el corte evita el bucle de reintentos"),
    ];
  },
};




const SCRIPT_APPROVAL_REJECTED: Script = ({ node, round, lastResult }) => {
  if (node === "supervisor") {
    if (round === 1) {
      return delegate(
        "ssh_specialist",
        "Configura el R1-core (SSH viva, R1#, CISCO): entra en modo configuración.",
        "task-hitl-1",
      );
    }
    return new AIMessage({
      content: lastResult.includes(APPROVAL_MESSAGE_PREFIXES.rejected)
        ? "El usuario rechazó la configuración: no he enviado ningún comando al equipo."
        : "Turno cerrado.",
    });
  }
  if (round === 1) {
    return toolCall("send_command", { command: "configure terminal" }, "cmd-hitl-1");
  }
  return new AIMessage({ content: "La acción fue rechazada; no la reintento." });
};

export const scenarioApprovalRejected: Scenario = {
  id: "aprobacion-rechazada",
  title: "Tool mutante con aprobación rechazada: no se ejecuta y el turno termina",
  byThat:
    "Decisión D1: el único HITL es el ApprovalMiddleware. Con rechazo, la tool NO debe ejecutarse, el contador de rechazos debe avanzar, el router debe ver el resultado como rejected y el turno debe cerrar (nada de reintentos ciegos ni turnos colgados).",
  async run() {
    const { measurement } = await runTurn({
      prompt: "configura el switch, entra en modo configuración",
      script: SCRIPT_APPROVAL_REJECTED,
      modelProviderId: "eval-aprobacion-rechazada",
      policyApproval: "rechazar",
    });
    return measurement;
  },
  comprobar(measurement) {
    const rechazos = measurement.modelcalls.filter((call) =>
      call.lastResult.includes(APPROVAL_MESSAGE_PREFIXES.rejected),
    );
    const primerBlock = rechazos[0]?.lastResult ?? "";
    const rechazosContados = /(\d+)\s+rechazos/.exec(primerBlock)?.[1];
    return [
      exact("escrituras en la consola", measurement.totalWrites, 0, "la tool no debe ejecutarse"),
      exact("aprobaciones pedidas", measurement.approvals.requested, 1),
      exact("aprobaciones rechazadas", measurement.approvals.rejected, 1),
      exact("aprobaciones aprobadas", measurement.approvals.approved, 0),
      min("bloqueos [APROBACION_RECHAZADA] vistos por el modelo", rechazos.length, 1),
      contract(
        "contador de rechazos avanza (1.º rechazo, sin corte)",
        rechazos.length === 1 && !primerBlock.includes("DETENTE"),
        rechazosContados ? `intentos=${rechazosContados}` : "intentos=1",
        "el corte por acumulación (2 rechazos → DETENTE) lo cubre deep-hitl.test.ts",
      ),
      contract(
        "el router lo vería como `rejected`",
        measurement.toolCalls.some((tool) => tool.status === "rejected") || rechazos.length >= 1,
        measurement.toolCalls.map((tool) => `${tool.name}:${tool.status}`).join(", ") ||
          "(tool interna del sub-agente: la ve el modelo, no el stream)",
      ),
      max("llm.calls", measurement.calls, 6, "el turno termina, no se cuelga"),
    ];
  },
};




const SCRIPT_QUESTION_THEORY: Script = ({ node }) => {
  if (node !== "supervisor") {
    throw new Error(
      `El especialista '${node}' recibió la pregunta teórica: la heurística del fast path y el ruteo real se han desincronizado.`,
    );
  }
  return new AIMessage({
    content:
      "OSPF es un protocolo de enrutamiento link-state: cada router construye el grafo completo de la red y calcula con Dijkstra la ruta de menor coste.",
  });
};

export const scenarioQuestionTheory: Scenario = {
  id: "pregunta-teorica",
  title: "Pregunta teórica con consola conectada: no se delega al especialista de terminal",
  byThat:
    "D3 (fast path) exige condiciones conservadoras: una pregunta teórica no es ejecución sobre ese equipo. El eval usa decidirFastPath como PREDICADO y comprueba que el ruteo real coincide, con la flag ENCENDIDA (que es cuando la vía rápida podría desviar el turno).",
  async run() {
    const { measurement } = await runTurn({
      prompt: "explícame OSPF",
      script: SCRIPT_QUESTION_THEORY,
      modelProviderId: "eval-pregunta-teorica",
      fastPath: true,
    });
    return measurement;
  },
  comprobar(measurement) {
    return [
      contract(
        "predicción de decidirFastPath: NO fast path",
        measurement.route.predicted === false,
        `motivo: ${measurement.route.reason}`,
      ),
      exact(
        "llm.calls del especialista de terminal",
        roundsOf(measurement, "ssh_specialist"),
        0,
        "una pregunta teórica no puede gastarle una sesión al dispositivo",
      ),
      exact("llm.calls totales", measurement.calls, 1, "el supervisor responde él mismo"),
      exact("delegaciones task", measurement.delegations, 0, "tampoco por la vía del supervisor"),
      exact("escrituras en la consola", measurement.totalWrites, 0),
      contract(
        "respuesta explica OSPF",
        /OSPF/i.test(measurement.reply),
        `${measurement.reply.slice(0, 48)}…`,
      ),
    ];
  },
  notas: [
    "El motivo de la heurística debe seguir siendo uno de los documentados (petición teórica), no una casualidad: es lo que permite confiar en el resto de casos.",
  ],
};




const SCRIPT_TOOL_DUPLICATE: Script = ({ node, round, lastResult }) => {
  if (node === "supervisor") {
    if (round === 1) {
      return delegate(
        "ssh_specialist",
        "En el R1-core (SSH viva, R1#, CISCO) lee el estado de la consola dos veces: primero 10 líneas y luego 40.",
        "task-dup-1",
      );
    }
    return new AIMessage({
      content: lastResult.includes(PREFIJO_LLAMADA_DUPLICADA)
        ? "Reutilicé la lectura anterior en vez de repetirla: el prompt es R1# y el equipo es un Cisco IOS XE."
        : "El prompt es R1# y el equipo es un Cisco IOS XE.",
    });
  }
  if (round === 1) return toolCall("read_terminal", { lines: 10 }, "lec-dup-1");
  if (round === 2) return toolCall("read_terminal", { lines: 40 }, "lec-dup-2");
  if (round === 3) return toolCall("read_terminal", { lines: 10 }, "lec-dup-3");
  return new AIMessage({ content: "Lecturas hechas." });
};

export const scenarioToolDuplicate: Scenario = {
  id: "tool-duplicada",
  title: "Lectura repetida con los mismos argumentos: la corta duplicateGuardMiddleware",
  byThat:
    "Fase 5/J: el turno real de 298 s con tres búsquedas web idénticas. El patrón A → B → A es el que el presupuesto deja pasar a propósito, así que lo replica este eval: la tercera llamada debe cortarse. Se usa `read_terminal` para que el caso sea el de siempre; el mismo criterio aplicado al payload real de `send_command` lo fija `hallazgo-send-command-duplicada`.",
  async run() {
    const { measurement } = await runTurn({
      prompt: "lee dos veces el estado de la consola del switch",
      script: SCRIPT_TOOL_DUPLICATE,
      modelProviderId: "eval-tool-duplicada",
    });
    return measurement;
  },
  comprobar(measurement) {
    const roundsSpecialist = roundsOf(measurement, "ssh_specialist");
    return [
      min(
        "bloqueos [LLAMADA_DUPLICADA] vistos por el modelo",
        roundsWithBlock(measurement, PREFIJO_LLAMADA_DUPLICADA),
        1,
        "la 3.ª lectura idéntica la corta la guarda",
      ),
      exact("rondas del especialista", roundsSpecialist, 4, "2 lecturas + el intento cortado + el cierre"),
      max("llm.calls", measurement.calls, 7, "el corte evita gastar la ronda en repetir"),
      contract(
        "la respuesta del supervisor sigue respondiendo al usuario",
        /R1#/.test(measurement.reply),
        `${measurement.reply.slice(0, 48)}…`,
      ),
    ];
  },
};




const SCRIPT_SEND_COMMAND_DUPLICATE: Script = ({ node, round, lastResult }) => {
  if (node === "supervisor") {
    if (round === 1) {
      return delegate(
        "ssh_specialist",
        "En el R1-core (SSH viva, R1#, CISCO) ejecuta 'show version' y después 'show ip interface brief'.",
        "task-send-dup",
      );
    }
    return new AIMessage({ content: `R1-core: ${lastResult.includes(PREFIJO_LLAMADA_DUPLICADA) ? "lectura reutilizada" : "IOS XE 16.12.4"}.` });
  }
  if (round === 1) return toolCall("send_command", { command: "show version" }, "cmd-sd-1");
  if (round === 2) return toolCall("send_command", { command: "show ip interface brief" }, "cmd-sd-2");
  if (round === 3) return toolCall("send_command", { command: "show version" }, "cmd-sd-3");
  return new AIMessage({ content: "Listo." });
};

export const scenarioFindingSendCommand: Scenario = {
  id: "hallazgo-send-command-duplicada",
  title: "`duplicateGuardMiddleware` corta un `send_command` repetido (E1 arreglado)",
  byThat:
    "Antes este escenario CARACTERIZABA un defecto: el payload de `send_command` incluye SIEMPRE el campo `\"timedOut\"`, y el patrón transitorio de `ToolErrorClassifier` (`\\b(timed? ?out|timeout|…)\\b`) casa con el NOMBRE del campo aunque valgue `false`, así que `indicaFallo()` creía que todo resultado era un fallo y la repetición exacta de la herramienta de terminal más usada NUNCA se cortaba. Arreglado, el eval fija el comportamiento correcto: la repetición exacta no llega al dispositivo y un `send_command` correcto ya no se clasifica como fallo.",
  async run() {
    const { measurement } = await runTurn({
      prompt: "ejecuta show version y show ip interface brief en el switch",
      script: SCRIPT_SEND_COMMAND_DUPLICATE,
      modelProviderId: "eval-hallazgo-send-command",
    });
    return measurement;
  },
  comprobar(measurement) {
    const lastOfSpecialist = measurement.modelcalls.find(
      (call) => call.node === "ssh_specialist" && call.lastResult,
    )?.lastResult;
    const clasificado = clasificarToolMessage({
      content: lastOfSpecialist,
      name: "send_command",
    });
    const failureSegunGuarda = indicaFallo(
      {
        content: lastOfSpecialist,
        status: null,
        toolCallId: "cmd-sd-1",
      },
      "send_command",
    );
    return [
      
      exact(
        "ejecuciones reales de `show version`",
        measurement.writes["show version"] ?? 0,
        1,
        "la 3.ª llamada idéntica NO llega al dispositivo: la guarda la corta",
      ),
      min(
        "bloqueos [LLAMADA_DUPLICADA] vistos por el modelo",
        roundsWithBlock(measurement, PREFIJO_LLAMADA_DUPLICADA),
        1,
      ),
      contract(
        "el `send_command` correcto ya NO se clasifica como fallo",
        clasificado.clase === "unknown" && !failureSegunGuarda,
        `${clasificado.clase}: ${clasificado.reason}`,
        "el payload lleva SIEMPRE `\"timedOut\":false`; el nombre del campo no es una señal de fallo",
      ),
    ];
  },
  notas: [
    "El arreglo decide el fallo por el VALOR, no por el nombre de la clave: `readCacheMiddleware.textoDeSenalesDeFallo` reconstruye el payload JSON dejando fuera los campos cuyo nombre asusta pero cuyo valor no señala nada (`timedOut:false`), y `ToolErrorClassifier` aplica los patrones sobre ese texto. Un `timedOut:true` sí se conserva (y `resultadoIndicaFallo` ya lo contaba).",
    "Los tres casos exigidos están fijados con la forma REAL del payload en `test/duplicate-tool-guard.test.ts` (`indicaFallo` con `timedOut:false`, `timedOut:true`, `% Invalid input detected`).",
  ],
};






const SCRIPT_DELEGATION_STREAM: Script = ({ node, round }) => {
  if (node === "supervisor") {
    if (round === 1) {
      return delegate(
        "ssh_specialist",
        "Lee la versión del R1-core (SSH viva, R1#, CISCO) y devuélvela.",
        "task-stream-1",
      );
    }
    return new AIMessage({ content: "El R1-core corre IOS XE 16.12.4." });
  }
  if (round === 1) return toolCall("send_command", { command: "show version" }, "cmd-stream-1");
  return new AIMessage({ content: "RESULTADO-ESPECIALISTA: IOS XE 16.12.4." });
};

export const scenarioDelegationStream: Scenario = {
  id: "delegacion-resultado-en-stream",
  title: "El ToolMessage de `task` llega al stream exactamente una vez (V6)",
  byThat:
    "deepagents devuelve el resultado de la delegación dentro de un Command, que streamMode:\"messages\" no emite: sin el arreglo de delegacionStream.ts la tarjeta se cerraba como «Acción no ejecutada» (V6).",
  async run() {
    const { measurement } = await runTurn({
      prompt: "dime la versión del switch",
      script: SCRIPT_DELEGATION_STREAM,
      modelProviderId: "eval-delegacion-stream",
    });
    return measurement;
  },
  comprobar(measurement) {
    const task = measurement.toolCalls.filter((tool) => tool.name === "task");
    const unicos = new Set(task.map((tool) => tool.toolCallId));
    
    
    
    const timesEnReply = measurement.reply.split("RESULTADO-ESPECIALISTA").length - 1;
    return [
      exact("ToolMessage de `task` en el stream", task.length, 1),
      exact("tool_call_id distintos de `task`", unicos.size, 1, "no se duplica el mismo id"),
      contract(
        "estado `completed` (no «Acción no ejecutada»)",
        task[0]?.status === "completed",
        task[0]?.status ?? "(ninguno)",
      ),
      contract(
        "el resultado trae el texto del especialista",
        (task[0]?.output ?? "").includes("RESULTADO-ESPECIALISTA"),
        `${(task[0]?.output ?? "").slice(0, 40)}…`,
      ),
      exact(
        "el texto aparece UNA vez en lo que ve el usuario",
        timesEnReply,
        1,
        "si el ToolMessage lo duplicara saldría 2 veces",
      ),
    ];
  },
};




const SCRIPT_FAST_PATH: Script = ({ round }) => {
  if (round === 1) return toolCall("send_command", { command: "show version" }, "cmd-fp-1");
  return new AIMessage({
    content: "El R1-core corre Cisco IOS XE Software, Version 16.12.4.",
  });
};

export const scenarioFastPath: Scenario = {
  id: "hallazgo-puerta-fast-path",
  title: "La puerta del fast path se abre con la forma real del chunk: 2 llamadas (≤3)",
  byThat:
    "Objetivo medible del plan: ≤3 llamadas LLM en consulta simple. Antes este escenario CARACTERIZABA un defecto: `fastPathStream.observarChunk` miraba `chunk.tool_calls` sobre el chunk CRUDO, pero `streamMode:\"messages\"` entrega tuplas `[mensaje, metadata]` (y `[namespace, [chunk, meta]]` con `subgraphs`), así que la puerta NUNCA se abría, el turno volvía al supervisor y el coste subía a 4. Arreglado con `deep/streamChunk.ts`, el eval fija el comportamiento correcto: la puerta ve la tool call, el turno lo resuelve el especialista y el objetivo ≤3 se cumple con holgura.",
  async run() {
    const { measurement } = await runTurn({
      prompt: "dime el modelo del sistema del switch",
      script: SCRIPT_FAST_PATH,
      modelProviderId: "eval-puerta-fastpath",
      fastPath: true,
    });
    return measurement;
  },
  comprobar(measurement) {
    return [
      contract(
        "la heurística predice fast path (decidirFastPath)",
        measurement.route.predicted,
        `motivo: ${measurement.route.reason}`,
        "la decisión de ruteo es correcta",
      ),
      min(
        "chunks del stream entregados como tupla [mensaje, metadata]",
        measurement.shapeChunks.tuples,
        1,
        "es la forma que la puerta tiene que normalizar (`deep/streamChunk.ts`)",
      ),
      exact(
        "llm.calls (objetivo del plan ≤3)",
        measurement.calls,
        2,
        "el especialista lee y responde: una llamada en vez de cuatro",
      ),
      exact(
        "llm.calls del supervisor",
        roundsOf(measurement, "supervisor"),
        0,
        "la puerta se abre con la tool call y el supervisor NO repite el turno",
      ),
      exact(
        "llm.calls del especialista",
        roundsOf(measurement, "ssh_specialist"),
        2,
        "la tool call + el cierre",
      ),
      exact(
        "delegaciones task",
        measurement.delegations,
        0,
        "sin supervisor no hay delegación que contar",
      ),
      contract(
        "el especialista llegó a ejecutar la tool (la puerta se abrió)",
        measurement.writes["show version"] === 1,
        `show version ×${measurement.writes["show version"] ?? 0}`,
        "sin esto la puerta se habría cerrado y el texto del especialista sería una suposición",
      ),
      exact("cola: líneas en el system prompt", measurement.mockConsole.linesEnSystemPrompt, 0),
      contract(
        "respuesta con el modelo del sistema",
        /IOS XE/i.test(measurement.reply),
        `${measurement.reply.slice(0, 48)}…`,
      ),
    ];
  },
  notas: [
    "El texto del especialista SÍ llega al usuario: la puerta retiene hasta la primera tool call y suelta lo retenido en cuanto se abre.",
  ],
};



export const scenarioFastPathConservative: Scenario = {
  id: "fastpath-conservador",
  title: "La frase exacta del objetivo del plan («quiero saber el modelo del sistema») SÍ va por la vía rápida",
  byThat:
    "Antes este escenario fijaba un LÍMITE conocido: `VERBOS_DE_EJECUCION` (agent/deep/fastPath.ts) no incluía «querer saber», así que la frase literal del objetivo del plan se clasificaba como «no hay intención de ejecución» y caía al supervisor aunque la puerta funcionara. Arreglado, el eval fija el comportamiento correcto: es una lectura sobre la consola, va por la vía rápida y cuesta 2 llamadas. El conservatism no se ha tocado: la marca TEÓRICA se comprueba antes que el verbo (`pregunta-teorica` lo comprueba).",
  async run() {
    const { measurement } = await runTurn({
      prompt: "quiero saber el modelo del sistema",
      script: SCRIPT_FAST_PATH,
      modelProviderId: "eval-fastpath-conservador",
      fastPath: true,
    });
    return measurement;
  },
  comprobar(measurement) {
    return [
      contract(
        "la heurística ve intención de LECTURA",
        measurement.route.predicted === true,
        `motivo: ${measurement.route.reason}`,
      ),
      exact(
        "llm.calls (objetivo del plan ≤3)",
        measurement.calls,
        2,
        "la vía rápida sustituye la delegación: 2 en vez de 4",
      ),
      exact(
        "llm.calls del supervisor",
        roundsOf(measurement, "supervisor"),
        0,
        "sin repliegue al supervisor",
      ),
      exact("delegaciones task", measurement.delegations, 0),
      contract(
        "el especialista ejecutó la lectura",
        measurement.writes["show version"] === 1,
        `show version ×${measurement.writes["show version"] ?? 0}`,
      ),
      contract(
        "respuesta con el modelo del sistema",
        /IOS XE/i.test(measurement.reply),
        `${measurement.reply.slice(0, 48)}…`,
      ),
    ];
  },
  notas: [
    "Contrapartida que fija `pregunta-teorica` («explícame OSPF» con la flag encendida): ampliar los verbos de lectura no abre la puerta a la teoría, porque `MARCAS_TEORICAS` se comprueba ANTES que `VERBOS_DE_EJECUCION`.",
  ],
};



export const scenarioCola25Lines: Scenario = {
  id: "cola-consola-25-lineas",
  title: "Selector de consola en 25 líneas: la cola va en el mensaje, acotada y saneada",
  byThat:
    "D2 en el otro extremo del rango 0/10/25/50/100: el volcado puede entrar, pero saneado por sanitizarConsola, acotado a las líneas pedidas y NUNCA en el prompt compilado que se cachea entre turnos.",
  async run() {
    const { measurement } = await runTurn({
      prompt: "dime el modelo del sistema del switch",
      script: SCRIPT_QUERY_SIMPLE,
      modelProviderId: "eval-cola-25",
      terminalContextLines: 25,
      terminalTail: TAIL_RAW_EVAL,
      fastPath: false,
    });
    return measurement;
  },
  comprobar(measurement) {
    const first = measurement.modelcalls[0];
    const tail = first?.prompt ?? "";

    const inner = tail.split(MARKER_TAIL_TERMINAL)[1] ?? "";
    const lines = inner.split("\n").filter((line) => line.trim().length > 0);
    return [
      exact(
        "líneas de cola en el mensaje del modelo",
        lines.length,
        25,
        "el selector está en 25 y el cliente mandó 30",
      ),
      exact(
        "cola: líneas del cliente que llegan al modelo",
        measurement.mockConsole.linesTailEnModel,
        24,
        "de las 25 líneas conservadas, 24 son del cliente y la última es el prompt",
      ),
      exact("cola: líneas en el system prompt", measurement.mockConsole.linesEnSystemPrompt, 0),
      contract(
        "la cola NO entra en el system prompt",
        !measurement.mockConsole.markerEnSystemPrompt && !first?.systemPrompt.includes(MARKER_TAIL),
        measurement.mockConsole.markerEnSystemPrompt ? "PRESENTE" : "ausente",
        "V3 cerrado por construcción: el prompt compilado no lleva consola",
      ),
      contract(
        "la cola viene saneada (sin ANSI)",
        !tail.includes("\u001b") && !tail.includes("\r"),
        tail.includes("\u001b") || tail.includes("\r") ? "CRUDA" : "saneada",
      ),
      contract(
        "la cola conserva el último eco del cliente",
        inner.includes("linea-cruda-30") && !inner.includes("linea-cruda-1\n"),
        inner.includes("linea-cruda-30") ? "última línea presente" : "ausente",
        "el recorte son las últimas N líneas, no las primeras",
      ),
      max(
        "input_tokens (1.ª llamada del supervisor)",
        first?.tokensInput ?? 0,
        7500,
        "peor caso razonable del selector: sigue holgado frente al presupuesto del turno",
      ),
      contract(
        "con la flag encendida, 25 líneas de cola NO descartan el fast path",
        measurement.route.predictedWithFlag === true,
        `motivo: ${measurement.route.reasonWithFlag}`,
        "E3 arreglado: `decidirFastPath` mide la longitud y las marcas sobre el texto SIN la cola (`textoSinColaDeTerminal`), porque la cola es salida del equipo, no petición del usuario",
      ),
      contract(
        "el texto con la cola SÍ supera MAX_CHARS (si no, el arreglo no estaría probando nada)",
        (measurement.modelcalls[0]?.prompt.length ?? 0) > 400,
        `${measurement.modelcalls[0]?.prompt.length ?? 0} chars en el mensaje`,
        "antes `decidirFastPath` rechazaba este mismo turno con «el turno es demasiado largo para un solo paso»",
      ),
    ];
  },
  notas: [
    "La cola se compone con `construirBloqueTailTerminal` (la misma función del router), así que el eval mide la ruta real y no una reconstrucción.",
  ],
};


export const SCENARIOS: Scenario[] = [
  scenarioQuerySimple,
  scenarioDelegationPt,
  scenarioToolFailureFinal,
  scenarioApprovalRejected,
  scenarioQuestionTheory,
  scenarioToolDuplicate,
  scenarioDelegationStream,
  scenarioFindingSendCommand,
  scenarioFastPath,
  scenarioFastPathConservative,
  scenarioCola25Lines,
];


export async function runScenario(scenario: Scenario): Promise<ResultScenario> {
  const measurement = await scenario.run();
  const checks = scenario.comprobar(measurement);
  return {
    id: scenario.id,
    title: scenario.title,
    byThat: scenario.byThat,
    passes: checks.every((check) => check.ok),
    measurement,
    checks,
    notas: scenario.notas ?? [],
  };
}
