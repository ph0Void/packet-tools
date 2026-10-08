import {
  arrancarBackend,
  iniciarSesionAdmin,
  conectarConsola,
  escribir,
  comoAdmin,
} from "../test/test-terminal/harness";
import { terminalSessionHub } from "@/sockets/TerminalSessionHub";

const [, , host = "127.0.0.1", portArg = "5001", deviceType = "Cisco 7200", username = "-", password = "-"] =
  process.argv;

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

const visible = (value: unknown) => String(value ?? "").replace(ANSI, "<ESC>").replace(/\r/g, "");

async function main() {
  const backendPort = await arrancarBackend();
  const url = "http://127.0.0.1:" + backendPort;
  const admin = await iniciarSesionAdmin(url);

  const consoleConn = await conectarConsola(url, admin.token, {
    type: "TELNET",
    host,
    port: Number(portArg),
    name: "diag-" + deviceType,
    typeDevice: deviceType,
    ...(username !== "-" ? { user: username } : {}),
    ...(password !== "-" ? { password } : {}),
  });

  const readSnapshot = async () =>
    await comoAdmin(admin, async () =>
      terminalSessionHub.getSnapshot(consoleConn.sessionId),
    );

  escribir("conectado a " + host + ":" + portArg + "  (typeDevice=" + deviceType + ")");

  const snapshot1 = (await readSnapshot())!;
  escribir("--- 1) SIN tocar nada ---");
  escribir("  prompt : " + visible(snapshot1.prompt ?? "(null)"));
  escribir("  alive  : " + snapshot1.alive);
  escribir("  lineas : " + (snapshot1.lastLines?.length ?? 0));
  escribir("  cola   : " + JSON.stringify(visible((snapshot1.lastLines ?? []).slice(-4)).slice(0, 400)));

  (consoleConn.session as any).write("\r");
  await new Promise((r) => setTimeout(r, 3000));
  const snapshot2 = (await readSnapshot())!;
  escribir("--- 2) tras un Return suelto ---");
  escribir("  prompt : " + visible(snapshot2.prompt ?? "(null)"));
  escribir("  lineas : " + (snapshot2.lastLines?.length ?? 0));
  escribir("  cola   : " + JSON.stringify(visible((snapshot2.lastLines ?? []).slice(-5)).slice(0, 400)));
  escribir("  hay ANSI: " + ((snapshot2.lastLines ?? []).some((line) => ANSI.test(String(line))) ? "SI" : "no"));

  const promptRes = await comoAdmin(admin, () =>
    terminalSessionHub.waitForPrompt(consoleConn.session, { timeoutMs: 12000 }),
  );
  escribir("  waitForPrompt -> prompt=" + visible(promptRes.prompt ?? "(null)") + "  vendor=" + promptRes.vendor);

  const cmdRes = await comoAdmin(admin, () =>
    terminalSessionHub.sendCommandDetailed(consoleConn.session, "show version", { maxMs: 25000 }),
  );
  escribir("--- 3) sendCommandDetailed('show version') ---");
  escribir("  executed : " + JSON.stringify(cmdRes.executed));
  escribir("  endReason: " + cmdRes.endReason + "  timedOut: " + cmdRes.timedOut);
  escribir("  prompt@  : " + visible(cmdRes.promptAtSend));
  escribir("  paged    : " + (cmdRes as any).paged + "  pages=" + (cmdRes as any).pages);
  escribir("  output   : " + JSON.stringify(visible(cmdRes.output).slice(0, 700)));

  const promptEcho = visible(cmdRes.output).split("[admin@MikroTik] >").length - 1;
  escribir("--- 4) ruido de consola ---");
  escribir("  chars totales  : " + cmdRes.output.length);
  escribir("  repeticiones de prompt: " + promptEcho);
  const lastPromptIndex = cmdRes.output.lastIndexOf(">");
  const tail = visible(cmdRes.output).slice(lastPromptIndex + 1).trim();
  escribir("  salida real (tras el ultimo prompt): " + tail.length + " chars");
  escribir("  >>> " + JSON.stringify(tail.slice(0, 400)));

  await consoleConn.cerrar();
  escribir("fin");
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { pararBackend } = await import("../test/test-terminal/harness");
    await pararBackend();
    process.exit(process.exitCode ?? 0);
  });
