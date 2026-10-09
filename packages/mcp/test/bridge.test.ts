
import { io as crearCliente, type Socket as SocketCliente } from "socket.io-client";
import {
  detenerBridge,
  esperarResultado,
  estadoBridge,
  iniciarBridge,
  solicitarTool,
} from "../src/domains/packetTracer/PacketTracerBridgeServer";


let fallos = 0;


const escriturasStdout: string[] = [];
const escribirPorStdout = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: unknown): boolean => {
  escriturasStdout.push(String(chunk));
  return true;
}) as typeof process.stdout.write;


function linea(texto: string): void {
  process.stderr.write(`${texto}\n`);
}


function comprobar(descripcion: string, condicion: boolean, detalle?: unknown): void {
  if (condicion) {
    linea(`  OK    ${descripcion}`);
  } else {
    fallos++;
    linea(`  FALLO ${descripcion}${detalle !== undefined ? ` → ${JSON.stringify(detalle)}` : ""}`);
  }
}


function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}


function conPlazo<T>(promesa: Promise<T>, ms = 5_000, etiqueta = "la respuesta"): Promise<T> {
  return Promise.race([
    promesa,
    esperar(ms).then(() => {
      throw new Error(`Plazo agotado (${ms} ms) esperando ${etiqueta}.`);
    }),
  ]);
}


async function esperarCondicion(condicion: () => boolean, ms = 3_000, paso = 20): Promise<boolean> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (condicion()) return true;
    await esperar(paso);
  }
  return condicion();
}


let urlBridge = "";


function conectar(opciones: { userAgent?: string; clientType?: string } = {}): Promise<SocketCliente> {
  return new Promise((resolver, rechazar) => {
    const socket = crearCliente(urlBridge, {
      transports: ["websocket"],
      
      reconnection: false,
      ...(opciones.clientType ? { query: { clientType: opciones.clientType } } : {}),
      ...(opciones.userAgent ? { extraHeaders: { "User-Agent": opciones.userAgent } } : {}),
    });
    socket.once("connect", () => resolver(socket));
    socket.once("connect_error", (error: Error) =>
      rechazar(new Error(error.message || "error de conexión")),
    );
  });
}


function conectarEsperandoRechazo(userAgent: string): Promise<string | null> {
  return new Promise((resolver) => {
    const socket = crearCliente(urlBridge, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { "User-Agent": userAgent },
    });
    socket.once("connect", () => {
      socket.close();
      resolver(null);
    });
    socket.once("connect_error", (error: Error) => {
      socket.close();
      resolver(error.message || "rechazado sin mensaje");
    });
  });
}


let responderAutomaticamente: ((toolCallId: string, toolName: string) => void) | null = null;


function espiar(promesa: Promise<unknown>): {
  promesa: Promise<unknown>;
  resuelta: () => boolean;
  valor: () => unknown;
} {
  const estado: { resuelta: boolean; valor: unknown } = { resuelta: false, valor: null };
  promesa.then(
    (resultado) => {
      estado.resuelta = true;
      estado.valor = resultado;
    },
    () => undefined,
  );
  return { promesa, resuelta: () => estado.resuelta, valor: () => estado.valor };
}


function texto(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (valor instanceof Error) {
    const sugerencia = (valor as Error & { sugerencia?: string }).sugerencia;
    return sugerencia ? `${valor.message} ${sugerencia}` : valor.message;
  }
  return JSON.stringify(valor ?? null);
}

async function main(): Promise<void> {
  linea("\n=== 1. Arranque del bridge en puerto efímero ===");
  await iniciarBridge({ puerto: 0 });
  const estadoInicial = estadoBridge();
  urlBridge = estadoInicial.url;
  linea(`  URL del bridge: ${urlBridge}`);
  comprobar("El bridge queda activo escuchando", estadoInicial.activo, estadoInicial);

  if (!estadoInicial.activo) {
    
    
    linea(
      "\n  El bridge no arrancó. Comprueba que MCP_BRIDGE_ENABLED no sea false en el .env del monorepo.\n",
    );
    process.exit(1);
  }

  
  
  await iniciarBridge({ puerto: 0 });
  comprobar(
    "iniciarBridge() dos veces es idempotente",
    estadoBridge().url === urlBridge && estadoBridge().activo,
    estadoBridge(),
  );

  linea("\n=== 2. Autenticación del handshake ===");
  const rechazo = await conectarEsperandoRechazo("Mozilla/5.0 (navegador normal)");
  comprobar("Un cliente que no es la extensión se rechaza en el handshake", rechazo !== null, {
    rechazo,
  });

  linea("\n=== 3. Registro de la extensión (user-agent Qt) ===");
  const extension = await conectar({
    userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 QtWebEngine/5.15 Chrome/83",
  });
  const registrada = await esperarCondicion(() => estadoBridge().extensionConectada);
  comprobar("El cliente con user-agent Qt se registra como extensión", registrada, estadoBridge());
  comprobar(
    "El socket registrado es el de la extensión",
    estadoBridge().socketExtension === extension.id,
    { esperado: extension.id, obtenido: estadoBridge().socketExtension },
  );

  
  
  responderAutomaticamente = (toolCallId, toolName) => {
    extension.emit("tool_result", { tool_call_id: toolCallId, result: { success: true, eco: toolName } });
  };
  extension.on("tool_call", (data: { tool_call_id: string; tool_name: string }) => {
    responderAutomaticamente?.(data.tool_call_id, data.tool_name);
  });

  linea("\n=== 4. tool_call + tool_result resuelve la promesa ===");
  const llamada = solicitarTool("getNetwork", { filtro: "todos" });
  comprobar(
    "El tool_call_id sigue el formato del protocolo (`tool-<nombre>-<uuid>`)",
    llamada.toolCallId.startsWith("tool-getNetwork-") &&
      llamada.toolCallId.length > "tool-getNetwork-".length,
    llamada,
  );
  comprobar(
    "La llamada queda registrada como pendiente",
    estadoBridge().peticionesPendientes === 1,
    estadoBridge(),
  );

  const resultado = (await conPlazo(esperarResultado(llamada.toolCallId), 5_000, "getNetwork")) as {
    eco?: string;
  };
  comprobar("La tool_result de la extensión resuelve la promesa", resultado?.eco === "getNetwork", resultado);
  comprobar("Tras resolver no queda nada pendiente", estadoBridge().peticionesPendientes === 0, estadoBridge());

  linea("\n=== 5. Un tool_result de otro socket se ignora ===");
  
  
  const intruso = await conectar({ userAgent: "Qt/5.15 (intruso)" });
  comprobar(
    "Una segunda extensión conecta pero no sustituye a la registrada",
    estadoBridge().socketExtension === extension.id,
    estadoBridge(),
  );

  responderAutomaticamente = null; 
  const suspendida = solicitarTool("pingDevices", {});
  const espia = espiar(esperarResultado(suspendida.toolCallId));
  intruso.emit("tool_result", {
    tool_call_id: suspendida.toolCallId,
    result: { success: true, hackeado: true },
  });
  await esperar(250);
  comprobar("El tool_result del socket no registrado NO resuelve la promesa", !espia.resuelta(), {
    resuelta: espia.resuelta(),
  });

  
  
  responderAutomaticamente = (toolCallId, toolName) => {
    extension.emit("tool_result", { tool_call_id: toolCallId, result: { success: true, eco: toolName } });
  };
  extension.emit("tool_result", {
    tool_call_id: suspendida.toolCallId,
    result: { success: true, eco: "pingDevices" },
  });
  const buena = (await conPlazo(espia.promesa, 5_000, "pingDevices")) as {
    eco?: string;
    hackeado?: boolean;
  };
  comprobar(
    "La llamada sigue pendiente y la resuelve la extensión registrada",
    buena?.eco === "pingDevices" && buena?.hackeado === undefined,
    buena,
  );
  intruso.close();

  linea("\n=== 6. tool_result huérfano se ignora ===");
  responderAutomaticamente = null;
  const antesHuerfano = estadoBridge().peticionesPendientes;
  extension.emit("tool_result", {
    tool_call_id: "tool-getNetwork-inexistente-0000",
    result: { success: true, inventado: true },
  });
  await esperar(150);
  comprobar(
    "Un tool_result huérfano no crea ni altera ninguna petición",
    estadoBridge().peticionesPendientes === antesHuerfano,
    { antes: antesHuerfano, despues: estadoBridge().peticionesPendientes },
  );

  
  const trasHuerfano = solicitarTool("getNetwork", {});
  responderAutomaticamente = (toolCallId, toolName) => {
    extension.emit("tool_result", { tool_call_id: toolCallId, result: { success: true, eco: toolName } });
  };
  const valorTrasHuerfano = (await conPlazo(
    esperarResultado(trasHuerfano.toolCallId),
    5_000,
    "la llamada tras el huérfano",
  )) as { eco?: string };
  comprobar(
    "Una llamada posterior al huérfano resuelve bien",
    valorTrasHuerfano?.eco === "getNetwork",
    valorTrasHuerfano,
  );

  linea("\n=== 7. tool_result repetido se ignora ===");
  responderAutomaticamente = null;
  const suspendida2 = solicitarTool("exportWorkspace", {});
  const espia2 = espiar(esperarResultado(suspendida2.toolCallId));

  
  
  extension.emit("tool_result", {
    tool_call_id: trasHuerfano.toolCallId,
    result: { success: true, eco: "getNetwork-REPETIDO" },
  });
  await esperar(250);
  comprobar("Un tool_result repetido NO resuelve otra promesa viva", !espia2.resuelta(), {
    resuelta: espia2.resuelta(),
  });

  responderAutomaticamente = (toolCallId, toolName) => {
    extension.emit("tool_result", { tool_call_id: toolCallId, result: { success: true, eco: toolName } });
  };
  extension.emit("tool_result", {
    tool_call_id: suspendida2.toolCallId,
    result: { success: true, eco: "exportWorkspace" },
  });
  const buena2 = (await conPlazo(espia2.promesa, 5_000, "exportWorkspace")) as { eco?: string };
  comprobar("La llamada sigue viva y la resuelve la extensión", buena2?.eco === "exportWorkspace", buena2);

  linea("\n=== 8. La extensión se desconecta con una llamada en vuelo ===");
  responderAutomaticamente = null;
  const alDesconectar = solicitarTool("applyDeviceConfig", { deviceName: "R1" });
  const enVuelo = esperarResultado(alDesconectar.toolCallId);
  extension.disconnect();

  
  
  const desenlace = await Promise.race([
    enVuelo.then(
      () => ({ ok: true, mensaje: "resolvió" }),
      (error: Error) => ({ ok: false, mensaje: texto(error) }),
    ),
    esperar(2_000).then(() => ({ ok: false, mensaje: "TIMEOUT: quedó colgada" })),
  ]);
  comprobar(
    "La llamada en vuelo NO queda colgada al desconectar la extensión",
    !desenlace.ok && desenlace.mensaje !== "TIMEOUT: quedó colgada",
    desenlace,
  );
  comprobar("El error explica que la extensión se desconectó", !desenlace.ok && /desconect/i.test(desenlace.mensaje), desenlace);
  comprobar("estadoBridge() ya no ve extensión conectada", !estadoBridge().extensionConectada, estadoBridge());
  comprobar("No queda ninguna petición pendiente colgada", estadoBridge().peticionesPendientes === 0, estadoBridge());

  linea("\n=== 9. Puente detenido y fallo rápido de solicitarTool ===");
  await detenerBridge();
  comprobar("Tras detenerBridge() el puente queda inactivo", !estadoBridge().activo, estadoBridge());
  comprobar("detenerBridge() dos veces no rompe nada", await detenerBridge().then(() => true));

  const fallo = (() => {
    try {
      solicitarTool("getNetwork", {});
      return null;
    } catch (error) {
      return texto(error);
    }
  })();
  comprobar("solicitarTool() falla rápido con un mensaje accionable", Boolean(fallo), { fallo });
  
  
  
  const urlAlParar = estadoBridge().url;
  comprobar("El mensaje menciona la URL del bridge del MCP", (fallo ?? "").includes(urlAlParar), {
    fallo,
    urlAlParar,
  });

  linea("\n=== 10. Nada se escribe en stdout (canal exclusivo del JSON-RPC) ===");
  process.stdout.write = escribirPorStdout;
  comprobar(
    "El proceso no escribió nada en stdout durante toda la prueba",
    escriturasStdout.length === 0,
    { escrituras: escriturasStdout.slice(0, 5) },
  );

  linea(
    fallos === 0
      ? "\n✅ Todas las comprobaciones del bridge pasaron.\n"
      : `\n❌ ${fallos} comprobación(es) fallaron.\n`,
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stdout.write = escribirPorStdout;
  linea("\n❌ La prueba del bridge falló con una excepción:");
  linea(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
});