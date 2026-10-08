
import net from "node:net";
import assert from "node:assert/strict";

import { terminalSessionHub } from "@/sockets/TerminalSessionHub";
import { requestContext } from "@/utils/RequestContext";


async function mockconsoleFake(): Promise<{
  port: number;
  escritas: string[];
  cerrar: () => void;
}> {
  const escritas: string[] = [];
  const server = net.createServer((socket) => {
    socket.write("PT-LAB> ");
    socket.on("data", (d: Buffer) => {
      const t = d.toString("utf8");
      escritas.push(t);
      
      socket.write(t.replace(/\r/g, "\r\n") + "PT-LAB> ");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as net.AddressInfo;
  return {
    port: addr.port,
    escritas,
    cerrar: () => server.close(),
  };
}

async function main() {
  const { port, escritas, cerrar } = await mockconsoleFake();
  console.log("consola falsa en el puerto " + port);

  
  
  const socketGlobal = net.connect(port, "127.0.0.1");
  await new Promise<void>((r) => socketGlobal.once("connect", r));

  
  const socketId = "abort-lab";
  let alive = true;
  terminalSessionHub.register({
    socketId,
    userId: "u1",
    providerId: null,
    protocol: "TELNET",
    deviceName: "lab",
    typeDevice: null,
    fingerprint: null,
    write: (data) => {
      if (alive) socketGlobal.write(data);
    },
    isAlive: () => alive,
  });
  const session = terminalSessionHub.get(socketId);
  assert.ok(session, "la sesión debe estar registrada");

  
  
  
  socketGlobal.setEncoding("utf8");
  socketGlobal.on("data", (d: string) => {
    terminalSessionHub.recordData(socketId, d);
  });

  let escritasTras = -1;
  let result: any = null;

  await requestContext.run(
    {
      id: "u1",
      username: "lab",
      role: "ADMIN",
      abortSignal: controller.signal,
    },
    async () => {
      
      
      const lote = Array.from({ length: 25 }, (_, i) => `show item ${i}`);
      const p = terminalSessionHub.runCommandsDetailed(session, lote, {
        maxMs: 8000,
      });


      setTimeout(() => {
        controller.abort();
        console.log(">> ABORT disparado a los 250 ms");
      }, 250);

      result = await p;

      escritasTras = escritas.length;
    },
  );


  await new Promise((r) => setTimeout(r, 700));
  const escritasFinal = escritas.length;

  alive = false;
  socketGlobal.destroy();
  terminalSessionHub.unregister(socketId);
  cerrar();

  const enviadas = escritas.join("").split("\r").filter((s) => s.trim());
  console.log("\n--- RESULTADO ---");
  console.log("lineas escritas en el dispositivo: " + enviadas.length);
  console.log("ejecutadas por el motor        : " + result?.executed?.length);
  console.log("escritas DESPUES del abort    : " + (escritasFinal - escritasTras));

  console.log("\nlineas recibidas por el dispositivo:");
  for (const e of enviadas) console.log("  | " + e.replace(/\r/g, ""));


  assert.ok(result, "deve devolver resultado");

  assert.equal(
    escritasFinal - escritasTras,
    0,
    "TRAS EL ABORT LLEGARON ESCRITURAS (comandos fantasma)",
  );

  assert.equal(
    result.executed.length,
    enviadas.length,
    "`executed` debe coincidir con lo que el dispositivo recibió (evita decir que se aplicaron 25 de 25 cuando se abortó)",
  );
  assert.ok(
    result.abortado === true,
    "el resultado debe declarar que el turno se abortó",
  );
  assert.equal(
    result.omitidasPorAbort?.length ?? 0,
    25 - enviadas.length,
    "las omitidas por abort deben ser las que NO salieron",
  );
  console.log(
    "\nOK: tras abortar, 0 escrituras adicionales en el dispositivo real.",
  );
  console.log(
    "OK: informe honesto -> executed=" +
      result.executed.length +
      ", omitidas=" +
      result.omitidasPorAbort.length +
      ", abortado=" +
      result.abortado,
  );
}

const controller = new AbortController();

main()
  .then(() => {
    console.log("\nPASS: no hay comandos fantasma.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("\nFAIL:", e?.message ?? e);
    process.exit(1);
  });
