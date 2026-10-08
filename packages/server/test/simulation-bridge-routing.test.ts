

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { io, Socket } from "socket.io-client";
import { server } from "@/app";
import { simulationBridge } from "@/sockets/SimulationBridge";

const CLIENTES: Socket[] = [];
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
    (server as HttpServer).listen(0);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(() => {

  while (CLIENTES.length) CLIENTES.pop()?.disconnect();
  simulationBridge.clearForTests();
});

afterAll(async () => {
  if ((server as HttpServer).listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});


function connect(clientType: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ["websocket"],
      reconnection: false,
      query: { clientType },
    });
    const limit = setTimeout(() => reject(new Error("Timeout conectando socket")), 10000);
    socket.on("connect", () => {
      clearTimeout(limit);
      CLIENTES.push(socket);
      resolve(socket);
    });
    socket.on("connect_error", (error: Error) => {
      clearTimeout(limit);
      reject(error);
    });
  });
}


function espiarResults(socket: Socket): { recibidos: any[] } {
  const recibidos: any[] = [];
  socket.on("tool_result", (data) => recibidos.push(data));
  return { recibidos };
}


function next<T = any>(socket: Socket, event: string, ms = 700): Promise<T | null> {
  return new Promise((resolve) => {
    const limit = setTimeout(() => {
      socket.off(event, alRecibir);
      resolve(null);
    }, ms);
    const alRecibir = (datum: T) => {
      clearTimeout(limit);
      socket.off(event, alRecibir);
      resolve(datum);
    };
    socket.on(event, alRecibir);
  });
}


function wait(ms = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Puente tool_call/tool_result: el resultado va solo a quien lo pidió", () => {
  it("entrega el resultado de la extensión exclusivamente al socket solicitante", async () => {
    const simulador = await connect("packet-tracer");
    const agent = await connect("backend-agent");

    const intruder = await connect("backend-agent");

    const espiaIntruder = espiarResults(intruder);
    const recibidoByExtension = next(simulador, "tool_call");
    agent.emit("tool_call", {
      tool_call_id: "ruteo-exclusivo",
      tool_name: "getNetwork",
      tool_input: {},
    });
    const reenviada = await recibidoByExtension;
    expect(reenviada?.tool_call_id).toBe("ruteo-exclusivo");

    const recibidoByAgent = next(agent, "tool_result");
    simulador.emit("tool_result", {
      tool_call_id: "ruteo-exclusivo",
      result: { success: true, devices: [] },
    });

    const reply = await recibidoByAgent;
    expect(reply?.tool_call_id).toBe("ruteo-exclusivo");
    expect(reply?.result.success).toBe(true);


    await wait();
    expect(espiaIntruder.recibidos).toHaveLength(0);
  });

  it("entrega también al navegador (solicitante autenticado) y no al resto", async () => {
    const simulador = await connect("packet-tracer");
    const browser = await connect("backend-agent");
    const espia = espiarResults(simulador);

    const reenviada = next(simulador, "tool_call");
    browser.emit("tool_call", {
      tool_call_id: "ruteo-navegador",
      tool_name: "getNetwork",
      tool_input: {},
    });
    expect((await reenviada)?.tool_call_id).toBe("ruteo-navegador");

    const reply = next(browser, "tool_result");
    simulador.emit("tool_result", {
      tool_call_id: "ruteo-navegador",
      result: { success: true, devices: [{ name: "R1" }] },
    });

    expect((await reply)?.result.devices[0].name).toBe("R1");
    await wait();
    expect(espia.recibidos).toHaveLength(0);
  });
});

describe("Puente tool_call/tool_result: no se falsifica la salida de otro", () => {
  it("ignora un tool_result forjado desde un socket que no es la extensión", async () => {
    const simulador = await connect("packet-tracer");
    const agent = await connect("backend-agent");
    const falsificador = await connect("backend-agent");

    const espiaAgent = espiarResults(agent);
    const espiaFalsificador = espiarResults(falsificador);

    const reenviada = next(simulador, "tool_call");
    agent.emit("tool_call", {
      tool_call_id: "forja-1",
      tool_name: "getDeviceInfo",
      tool_input: { deviceName: "R1" },
    });
    expect((await reenviada)?.tool_call_id).toBe("forja-1");


    falsificador.emit("tool_result", {
      tool_call_id: "forja-1",
      result: { success: true, fabricated: true },
    });
    await wait();


    expect(espiaAgent.recibidos).toHaveLength(0);
    expect(espiaFalsificador.recibidos).toHaveLength(0);


    const replyReal = next(agent, "tool_result");
    simulador.emit("tool_result", {
      tool_call_id: "forja-1",
      result: { success: true, interfaces: [] },
    });
    expect((await replyReal)?.result.fabricated).toBeUndefined();
  });

  it("descarta un tool_result huérfano (nadie pidió esa llamada)", async () => {
    const simulador = await connect("packet-tracer");
    const agent = await connect("backend-agent");
    const espia = espiarResults(agent);

    simulador.emit("tool_result", {
      tool_call_id: "nunca-existio",
      result: { success: true },
    });
    await wait();
    expect(espia.recibidos).toHaveLength(0);
  });

  it("descarta un tool_result sin tool_call_id", async () => {
    const simulador = await connect("packet-tracer");
    const agent = await connect("backend-agent");
    const espia = espiarResults(agent);

    simulador.emit("tool_result", { result: { success: true } });
    await wait();
    expect(espia.recibidos).toHaveLength(0);
  });

  it("solo entrega una respuesta por llamada (la repetición no re-resuelve)", async () => {
    const simulador = await connect("packet-tracer");
    const agent = await connect("backend-agent");
    const espia = espiarResults(agent);

    const reenviada = next(simulador, "tool_call");
    agent.emit("tool_call", { tool_call_id: "unica", tool_name: "getNetwork", tool_input: {} });
    await reenviada;

    simulador.emit("tool_result", { tool_call_id: "unica", result: { success: true, n: 1 } });
    const first = await next(agent, "tool_result");
    expect(first?.result.n).toBe(1);


    simulador.emit("tool_result", { tool_call_id: "unica", result: { success: true, n: 2 } });
    await wait();
    expect(espia.recibidos).toHaveLength(1);
    expect(espia.recibidos[0].result.n).toBe(1);
  });

  it("no deja que otro socket secustre una tool_call pendiente", async () => {
    const simulador = await connect("packet-tracer");
    const agent = await connect("backend-agent");
    const atacante = await connect("backend-agent");
    const espiaAtacante = espiarResults(atacante);

    const reenviada = next(simulador, "tool_call");
    agent.emit("tool_call", { tool_call_id: "secuestro", tool_name: "getNetwork", tool_input: {} });
    expect((await reenviada)?.tool_call_id).toBe("secuestro");


    atacante.emit("tool_call", {
      tool_call_id: "secuestro",
      tool_name: "getNetwork",
      tool_input: { deviceName: "atacado" },
    });
    await wait(500);

    const replyReal = next(agent, "tool_result");
    simulador.emit("tool_result", { tool_call_id: "secuestro", result: { success: true } });
    const reply = await replyReal;


    expect(reply?.result.success).toBe(true);
    expect(espiaAtacante.recibidos).toHaveLength(0);
  });

  it("libera la llamada cuando no hay extensión: el error vuelve al solicitante", async () => {
    const agent = await connect("backend-agent");

    const reply = next(agent, "tool_result");
    agent.emit("tool_call", { tool_call_id: "sin-extension", tool_name: "addDevice", tool_input: {} });
    const error = await reply;

    expect(error?.result.success).toBe(false);
    expect(String(error?.result.error)).toMatch(/Packet Tracer/i);
  });
});
