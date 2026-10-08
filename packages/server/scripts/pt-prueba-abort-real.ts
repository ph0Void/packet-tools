import net from "node:net";

import { terminalSessionHub } from "@/sockets/TerminalSessionHub";
import { requestContext } from "@/utils/RequestContext";

const [, , brand = "cisco", host = "127.0.0.1", portArg = "5001", deviceType = "CISCO", username, password] =
  process.argv;

const assertCheck = (passed: boolean, message: string, detail = "") => {
  console.log((passed ? "  OK   " : "  FALLO ") + message + (detail ? "  -> " + detail : ""));
  if (!passed) process.exitCode = 1;
};

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
}

async function main() {
  const socketId = "abort-real-" + Date.now();
  const rawSocket = net.connect(Number(portArg), host);
  rawSocket.setEncoding("utf8");
  let received = "";
  rawSocket.on("data", (chunk: string) => {
    received += chunk;
    terminalSessionHub.recordData(socketId, chunk);
  });
  await new Promise<void>((resolve, reject) => {
    rawSocket.once("connect", resolve);
    rawSocket.once("error", reject);
  });

  let alive = true;
  const outbound: string[] = [];
  terminalSessionHub.register({
    socketId,
    userId: "abort-real",
    providerId: null,
    protocol: "TELNET",
    deviceName: brand,
    typeDevice: deviceType,
    fingerprint: null,
    write: (data) => {
      if (alive) {
        outbound.push(data);
        rawSocket.write(data);
      }
    },
    isAlive: () => alive && !rawSocket.destroyed,
  });
  const session = terminalSessionHub.get(socketId);
  if (!session) throw new Error("la sesión no se registró en el hub");

  if (username) {
    const waitForPattern = async (pattern: RegExp, ms: number): Promise<boolean> => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (pattern.test(stripAnsi(received).slice(-200))) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    };

    if (!(await waitForPattern(/login\s*:|user\s*:/i, 2500))) {
      rawSocket.write("\r\n");
      await new Promise((r) => setTimeout(r, 700));
      if (!(await waitForPattern(/login\s*:|user\s*:/i, 3000))) {
        rawSocket.write("\r\n");
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    rawSocket.write(username + "\r\n");
    const askedPassword = await waitForPattern(/password\s*:/i, 3000);
    if (askedPassword && password) rawSocket.write(password + "\r\n");
    const entered = await waitForPattern(/[\][\w@.\-]*\s*>\s*$/m, 8000);
    console.log(
      "login: password=" +
        (askedPassword ? "si" : "no") +
        ", prompt=" +
        (entered ? "si" : "NO"),
    );
    if (!entered) {
      console.log("  (cola: " + JSON.stringify(stripAnsi(received).slice(-160)) + ")");
    }
  }

  const controller = new AbortController();
  const BATCH = Array.from(
    { length: 60 },
    () => (brand.toLowerCase() === "mikrotik" ? "/system resource print" : "show clock"),
  );
  const ABORT_MS = 3500;

  const ready = await new Promise<boolean>((r) => {
    const timer = setTimeout(() => r(false), 12000);
    const pollTimer = setInterval(() => {
      if (stripAnsi(received).slice(-80).match(/[>#]\s*$/)) {
        clearInterval(pollTimer);
        clearTimeout(timer);
        r(true);
      }
    }, 250);
  });
  console.log("consola lista: " + ready);

  console.log("=== ABORT EN EQUIPO REAL: " + brand + " (" + host + ":" + portArg + ")");

  let result: any = null;
  await requestContext.run(
    { id: "abort-real", username: "lab", role: "ADMIN", abortSignal: controller.signal },
    async () => {
      const beforeBatchLength = received.length;
      const batchPromise = terminalSessionHub.runCommandsDetailed(session, BATCH, { maxMs: 60000 });
      setTimeout(() => {
        controller.abort();
        console.log(">> ABORT disparado a los " + ABORT_MS + " ms (lote en marcha)");
      }, ABORT_MS);
      result = await batchPromise.catch((error: any) => ({ error: String(error?.message ?? error) }));
      void beforeBatchLength;
    },
  );

  const beforeLen = received.length;
  await new Promise((r) => setTimeout(r, 2500));
  const afterLen = received.length;
  const bytesAfter = afterLen - beforeLen;

  alive = false;
  rawSocket.destroy();
  terminalSessionHub.unregister(socketId);

  console.log("\n--- RESULTADO ---");
  console.log("lote enviado        : " + BATCH.length + " comandos de lectura");
  console.log("executed (real)     : " + (result?.executed?.length ?? 0));
  console.log("omitidasPorAbort    : " + (result?.omitidasPorAbort?.length ?? 0));
  console.log("abortado            : " + (result?.abortado ?? false));
  console.log("bytes del equipo DESPUES del abort: " + bytesAfter);
  const tail = stripAnsi(received).slice(-400);

  console.log("\n--- VERIFICACIONES ---");
  const executedCount = result?.executed?.length ?? 0;
  const skippedCount = result?.omitidasPorAbort?.length ?? 0;

  assertCheck(
    skippedCount > 0 || executedCount < BATCH.length,
    "el lote se interrumpió (no se escribieron las " + BATCH.length + " líneas)",
  );
  assertCheck(
    executedCount + skippedCount === BATCH.length,
    "el informe cuadra: executed + omitidas = " + BATCH.length,
  );

  const sentCount = outbound.filter(
    (chunk) => chunk.indexOf(BATCH[0].slice(0, 6)) !== -1,
  ).length;
  assertCheck(
    sentCount <= executedCount,
    "al socket NO salieron más comandos de los que el motor declara (sin fantasmas)",
    "salieron=" + sentCount + ", executed=" + executedCount,
  );
  assertCheck(
    sentCount === executedCount,
    "el conteo de escrituras reales cuadra con `executed`",
    "salieron=" + sentCount + ", executed=" + executedCount,
  );
  assertCheck(
    result?.abortado === true,
    "el resultado declara que el turno se abortó",
    "abortado=" + (result?.abortado ?? false),
  );
  assertCheck(
    bytesAfter < BATCH.length,
    "tras el abort el equipo solo ensucia lo que ya estaba en vuelo",
    "bytes=" + bytesAfter,
  );
  console.log(
    "\n(detalle: " +
      executedCount +
      " escritas, " +
      skippedCount +
      " omitidas por abort, " +
      sentCount +
      " salidas reales por el socket)",
  );
  console.log(
    "(ultimos " + tail.length + " chars del equipo): " + JSON.stringify(tail.slice(-160)),
  );
}

main()
  .catch((error) => {
    console.error("ERROR:", error?.message ?? error);
    process.exit(1);
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 200));
