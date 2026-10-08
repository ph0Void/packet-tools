

import { describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import {
  construirBloqueTailTerminal,
} from "@/api/router/turnoStream";
import {
  decidirFastPath,
  especialistaPorProtocolo,
  FAST_PATH_FALLBACK,
  FAST_PATH_REGLAS,
  MARCADOR_COLA_TERMINAL,
  textoSinColaDeTerminal,
  type FastPathInput,
} from "@/agent/deep/fastPath";
import {
  chunkTraeToolCall,
  contieneFallback,
  fastPathStream,
  MOTIVOS_FALLBACK,
  motivoDeFallback,
  nuevaPuerta,
  observarChunk,
  textoDeChunk,
  veredictoDePuerta,
  verdictDeStream,
} from "@/agent/deep/fastPathStream";
import { envConfig } from "@/config/EnvConfig";


const BASE: FastPathInput = {
  enabled: true,
  origin: "terminal",
  role: "ADMIN",
  connection: {
    name: "R1-core",
    protocol: "SSH",
    typeDevice: "CISCO",
    alive: true,
  },
  textoUsuario: "muestrame la tabla de rutas",
};

describe("heuristica del fast path", () => {
  it("CASO EJECUCIÓN: va directo al especialista", () => {
    for (const text of [
      "muestrame la tabla de rutas",
      "ejecuta show version en el equipo",
      "configura la interfaz gigabitethernet0/0 con la direccion 10.0.0.1/24",
      "haz un ping a 8.8.8.8",
      "revisa el uso de cpu",
      "guarda la configuracion",
    ]) {
      const decision = decidirFastPath({ ...BASE, textoUsuario: text });
      expect(decision.ir, `esperaba via rapida para "${text}"`).toBe(true);
      expect(decision.especialista).toBe("ssh");
    }
  });

  it("CASO TEÓRICO: NO va al especialista (nada de 「explícame OSPF」)", () => {
    for (const text of [
      "explícame OSPF",
      "explicame que es un area OSPF",
      "cual es la diferencia entre OSPF y EIGRP",
      "para que sirve el protocolo BGP",
      "como funciona el spanning tree",
      "recomienda una buena practica de seguridad",
      "que significa el prompt [admin@MikroTik]",
    ]) {
      const decision = decidirFastPath({ ...BASE, textoUsuario: text });
      expect(decision.ir, `no debia ir por via rapida: "${text}"`).toBe(false);
      expect(decision.especialista).toBeNull();
      expect(decision.reason).toMatch(/teórica|teorica|flag|consola|terminal/);
    }
  });

  it("CASO DUDOSO: va al supervisor", () => {
    const dudosos: Array<[string, FastPathInput]> = [
      ["sin verbo de ejecución", { ...BASE, textoUsuario: "hola, buen dia" }],
      [
        "menciona otro sistema",
        { ...BASE, textoUsuario: "muestrame el proyecto de GNS3 y sus nodos" },
      ],
      [
        "menciona Packet Tracer",
        { ...BASE, textoUsuario: "crea un router en packet tracer" },
      ],
      [
        "texto larguisimo (plan de varios pasos)",
        { ...BASE, textoUsuario: `configura ${"cosas ".repeat(80)}` },
      ],
      [
        "dos dispositivos",
        { ...BASE, textoUsuario: "haz ping a R1 y a R2" },
      ],
      ["sin texto", { ...BASE, textoUsuario: "   " }],
    ];
    for (const [name, input] of dudosos) {
      const decision = decidirFastPath(input);
      expect(decision.ir, `no debia ir por via rapida: ${name}`).toBe(false);
      expect(decision.reason.length).toBeGreaterThan(5);
    }
  });

  it("las condiciones estructurales: flag, origen, consola viva y protocolo", () => {
    expect(decidirFastPath({ ...BASE, enabled: false }).ir).toBe(false);
    expect(decidirFastPath({ ...BASE, origin: "chat" }).ir).toBe(false);
    expect(
      decidirFastPath({
        ...BASE,
        connection: { ...BASE.connection!, alive: false },
      }).ir,
    ).toBe(false);
    expect(decidirFastPath({ ...BASE, connection: null }).ir).toBe(false);

    expect(
      decidirFastPath({
        ...BASE,
        connection: {
          name: "lab",
          protocol: "SIMULATION",
          typeDevice: "PACKET_TRACER",
          alive: true,
        },
      }).ir,
    ).toBe(false);

    expect(decidirFastPath({ ...BASE, webRequired: true }).ir).toBe(false);
    expect(decidirFastPath({ ...BASE, skillRequested: "ospf-area-0" }).ir).toBe(false);

    expect(decidirFastPath({ ...BASE, ragPrefetched: true }).ir).toBe(true);
  });

  it("el protocolo decide el especialista", () => {
    expect(especialistaPorProtocolo("ssh")).toBe("ssh");
    expect(especialistaPorProtocolo("TELNET")).toBe("telnet");
    expect(especialistaPorProtocolo("Serial")).toBe("serial");
    expect(especialistaPorProtocolo("SIMULATION")).toBeNull();
    expect(especialistaPorProtocolo(null)).toBeNull();
    const telnet = decidirFastPath({
      ...BASE,
      connection: { ...BASE.connection!, protocol: "TELNET" },
      textoUsuario: "muestrame el uso de memoria",
    });
    expect(telnet).toMatchObject({ ir: true, specialist: "telnet" });
  });

  it("la flag del env está apagada por defecto (se activa con los evals)", () => {
    expect(envConfig.FAST_PATH_ENABLED).toBe(false);
  });

  it("CASO LECTURA: «quiero saber…» también es intención de lectura", () => {

    for (const text of [
      "quiero saber el modelo del sistema",
      "quiero saber cual es el modelo del switch",
      "cual es el modelo del sistema",
      "que version corre en el equipo",
    ]) {
      const decision = decidirFastPath({ ...BASE, textoUsuario: text });
      expect(decision.ir, `esperaba via rapida para "${text}" (${decision.reason})`).toBe(true);
      expect(decision.especialista).toBe("ssh");
    }
  });

  it("adjuntar la cola de consola NO desactiva la vía rápida", () => {

    const tail = construirBloqueTailTerminal(
      25,
      `${Array.from(
        { length: 30 },
        (_, i) => `linea-${i + 1} ${"contenido de la salida del equipo".repeat(3)}`,
      ).join("\n")}\nR1# `,
    );
    expect(tail.length).toBeGreaterThan(400);
    const prompt = `quiero saber el modelo del sistema${tail}`;

    expect(decidirFastPath({ ...BASE, textoUsuario: prompt }).ir).toBe(true);

    expect(decidirFastPath({ ...BASE, textoUsuario: `configura la vlan 10${tail}` }).ir).toBe(true);

    expect(prompt.length).toBeGreaterThan(400);
  });

  it("la cola no se cuela en las marcas que deciden el ruteo", () => {

    const tail = construirBloqueTailTerminal(10, "packet tracer\nexplicame ospf\nR1# ");
    expect(
      decidirFastPath({ ...BASE, textoUsuario: `muestra la tabla de rutas${tail}` }).ir,
    ).toBe(true);

    expect(decidirFastPath({ ...BASE, textoUsuario: "explícame OSPF" }).ir).toBe(false);
  });

  it("el marcador de la cola es el que compone el router (no puede divergir)", () => {
    const tail = construirBloqueTailTerminal(3, "R1# show version\nCisco IOS XE\nR1# ");
    expect(tail.trimStart().startsWith(MARCADOR_COLA_TERMINAL)).toBe(true);
    expect(textoSinColaDeTerminal(`dime la version${tail}`)).toBe("dime la version");

    expect(textoSinColaDeTerminal("dime la version")).toBe("dime la version");
  });

  it("un texto largo de verdad (plan de varios pasos) sigue yendo al supervisor", () => {
    const tail = construirBloqueTailTerminal(25, "x\n".repeat(200));
    const decision = decidirFastPath({
      ...BASE,
      textoUsuario: `configura ${"cosas ".repeat(120)}${tail}`,
    });
    expect(decision.ir).toBe(false);
    expect(decision.reason).toMatch(/largo/);
  });
});

describe("puerta del stream: como se detecta que el especialista no resolvió", () => {
  it("reconoce tool calls y texto en los chunks", () => {
    expect(chunkTraeToolCall(chunkTool("send_command"))).toBe(true);
    expect(chunkTraeToolCall(chunkText("hola"))).toBe(false);
    expect(textoDeChunk(chunkText("hola"))).toBe("hola");
    expect(textoDeChunk(new HumanMessage("hola"))).toBe("");
    expect(contieneFallback(`[FAST_PATH_FALLBACK] no aplica`)).toBe(true);
  });

  it("la puerta ve las tool calls con la FORMA REAL del chunk (tuplas)", () => {

    for (const item of [
      itemReal(chunkTool("send_command")),
      itemReal(chunkTool("send_command"), { subgraph: true }),
      chunkTool("send_command"),
    ]) {
      expect(chunkTraeToolCall(item), "no vio la tool call del especialista").toBe(true);
      expect(verdictDeStream([item]), "dio al especialista por no resuelto").toMatchObject({
        resolved: true,
        toolCalls: 1,
      });
    }
  });

  it("el texto también se lee a través de la tupla (marcador de fallback)", () => {
    for (const item of [
      itemReal(chunkText(`${FAST_PATH_FALLBACK} es teoria, no de esta consola`)),
      itemReal(chunkText(`${FAST_PATH_FALLBACK} es teoria`), { subgraph: true }),
    ]) {
      expect(textoDeChunk(item)).toContain(FAST_PATH_FALLBACK);
      expect(verdictDeStream([item]).reason).toBe(MOTIVOS_FALLBACK.marcador);
    }

    expect(verdictDeStream([itemReal(chunkText("esto es teoria"))])).toMatchObject({
      resolved: false,
      reason: MOTIVOS_FALLBACK.sinToolCalls,
    });
  });

  it("la puerta se abre con la forma real y NO devuelve el turno al supervisor", async () => {
    const supervisor = vi.fn();
    const output = await recoge(
      fastPathStream({

        specialist: streamOf([
          itemReal(chunkText("voy a leer el estado")),
          itemReal(chunkTool("get_terminal_status")),
          itemReal(chunkText("R1 responde")),
        ]),
        supervisor: supervisor as never,
        etiqueta: "ssh_specialist",
      }),
    );
    expect(output).toHaveLength(3);
    expect(supervisor).not.toHaveBeenCalled();
  });

  it("regla: sin tool calls y sin marcador, NO resolvió", () => {
    expect(verdictDeStream([chunkText("esto es teoria")])).toMatchObject({
      resolved: false,
      reason: MOTIVOS_FALLBACK.sinToolCalls,
    });
    expect(verdictDeStream([])).toMatchObject({ resolved: false });
  });

  it("regla: el marcador de fallback significa NO resolvió", () => {
    const verdict = verdictDeStream([
      chunkText(`${FAST_PATH_FALLBACK} es teoria, no de esta consola`),
    ]);
    expect(verdict.resuelto).toBe(false);
    expect(verdict.reason).toBe(MOTIVOS_FALLBACK.marcador);
    expect(FAST_PATH_REGLAS.marcador).toBe(FAST_PATH_FALLBACK);
  });

  it("regla: con tool calls, resolvió", () => {
    expect(
      verdictDeStream([chunkTool("get_terminal_status"), chunkText("listo")]),
    ).toMatchObject({ resolved: true, toolCalls: 1 });
  });

  it("la puerta acumula: el veredicto coincide con el stream recorrido", () => {
    const gate = nuevaPuerta();
    const chunks = [
      chunkText("voy a leer el estado"),
      chunkTool("get_terminal_status"),
      chunkText("R1 responde"),
    ];
    for (const chunk of chunks) observarChunk(gate, chunk);
    expect(gate.abierta).toBe(true);
    expect(motivoDeFallback(gate)).toBeNull();

    expect(veredictoDePuerta(gate)).toEqual(verdictDeStream(chunks));
  });

  it("la puerta y el veredicto coinciden tambien cuando NO resuelto", () => {
    const gate = nuevaPuerta();
    for (const chunk of [chunkText("sin tool ninguna")]) observarChunk(gate, chunk);
    expect(motivoDeFallback(gate)).toBe(MOTIVOS_FALLBACK.sinToolCalls);
    expect(veredictoDePuerta(gate)).toEqual(
      verdictDeStream([chunkText("sin tool ninguna")]),
    );
  });
});


function chunkText(text: string) {
  return new AIMessage(text);
}


function chunkTool(name: string) {
  return new AIMessage({
    content: "",
    tool_calls: [{ name: name, args: {}, id: "c1", type: "tool_call" as const }],
  });
}



function itemReal(mensaje: unknown, opciones: { subgraph?: boolean } = {}): unknown {
  const withMeta = [mensaje, { langgraph_node: "agent" }];
  return opciones.subgraph ? ["ssh_specialist", withMeta] : withMeta;
}


async function* streamOf(chunks: unknown[]) {
  for (const chunk of chunks) yield chunk;
}

async function recoge(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const output: unknown[] = [];
  for await (const chunk of stream) output.push(chunk);
  return output;
}

describe("fastPathStream: la salida del especialista o la del supervisor", () => {
  it("en la vía rápida el especialista manda su salida y NO se llama al supervisor", async () => {
    const supervisor = vi.fn();
    const output = await recoge(
      fastPathStream({
        specialist: streamOf([
          chunkText("voy a leer el estado"),
          chunkTool("get_terminal_status"),
          chunkText("R1 responde"),
        ]),
        supervisor: supervisor as never,
        etiqueta: "ssh_specialist",
      }),
    );
    expect(output).toHaveLength(3);
    expect(supervisor).not.toHaveBeenCalled();
  });

  it("si el especialista pide devolver el turno, se descarta su texto y manda el supervisor", async () => {
    const supervisor = vi.fn(async () => streamOf([chunkText("respuesta del supervisor")]));
    const onFallback = vi.fn();
    const output = await recoge(
      fastPathStream({
        specialist: streamOf([
          chunkText(`${FAST_PATH_FALLBACK} es una pregunta de teoria`),
        ]),
        supervisor: supervisor as never,
        etiqueta: "ssh_specialist",
        onFallback,
      }),
    );
    expect(supervisor).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(output).toHaveLength(1);
    expect(textoDeChunk(output[0])).toBe("respuesta del supervisor");
  });

  it("si cierra sin tocar el dispositivo, tampoco resolvió (y no se mostró su texto)", async () => {
    const supervisor = vi.fn(async () => streamOf([chunkText("del supervisor")]));
    const output = await recoge(
      fastPathStream({
        specialist: streamOf([chunkText("no puedo hacer eso")]),
        supervisor: supervisor as never,
        etiqueta: "telnet_specialist",
      }),
    );
    expect(supervisor).toHaveBeenCalledTimes(1);
    expect(output).toHaveLength(1);
    expect(textoDeChunk(output[0])).toBe("del supervisor");
  });
});
