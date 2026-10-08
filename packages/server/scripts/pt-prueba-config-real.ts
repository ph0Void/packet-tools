import {
  arrancarBackend,
  iniciarSesionAdmin,
  conectarConsola,
  escribir,
  comoAdmin,
  esperarPrompt,
  type ConsolaConectada,
} from "../test/test-terminal/harness";
import { terminalSessionHub } from "@/sockets/TerminalSessionHub";

const WAIT_OPTS = { idleMs: 800, maxMs: 30_000 };

const [, , brand = "cisco", host = "127.0.0.1", portArg = "5001", deviceType = "CISCO", username, password] =
  process.argv;

const STAMP = "PT-PROBA-" + Date.now().toString().slice(-6);
const IS_CISCO = brand.toLowerCase() === "cisco";

const formatStatus = (passed: boolean) => (passed ? "OK  " : "FALLO");
let failures = 0;
const assertCheck = (condition: boolean, message: string, detail = "") => {
  if (!condition) failures++;
  escribir("  " + formatStatus(condition) + " " + message + (detail ? "  -> " + detail : ""));
};

const INITIAL_CONSOLE_WAIT_MS = 6_000;
const AFTER_RETURN_WAIT_MS = 40_000;
const CREDENTIALS_WAIT_MS = 20_000;

function getSnapshot(consoleConn: ConsolaConectada): ReturnType<typeof terminalSessionHub.getSnapshot> {
  return terminalSessionHub.getSnapshot(consoleConn.sessionId);
}

function normalizePrompt(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authenticateIfNeeded(consoleConn: ConsolaConectada): Promise<boolean> {
  escribir("-- 0) autenticación (solo si la consola la pide) --");
  if (!username) {
    escribir("     este equipo se prueba sin credenciales: solo se espera al prompt");
    const ready = await esperarPrompt(consoleConn.session, INITIAL_CONSOLE_WAIT_MS + 20_000);
    assertCheck(
      Boolean(ready.prompt) && ready.promptWaitMessage === null,
      "la consola da prompt sin credenciales: " +
        `prompt=${JSON.stringify(normalizePrompt(ready.prompt))} ` +
        `despertar=${JSON.stringify(ready.despertar)} ${ready.promptWaitMessage ?? ""}`,
      `no apareció prompt: motivoSinPrompt=${ready.motivoSinPrompt} ` +
        `ultimaLinea=${JSON.stringify(normalizePrompt(ready.ultimaLinea))} ` +
        `${ready.promptWaitMessage ?? ""}`,
    );
    return Boolean(ready.prompt);
  }

  let deadline = Date.now() + INITIAL_CONSOLE_WAIT_MS;
  let returnsSent = 0;
  let state = getSnapshot(consoleConn);
  while (
    Date.now() < deadline &&
    !state?.prompt &&
    state?.motivoSinPrompt !== "login_pendiente"
  ) {
    await sleep(400);
    state = getSnapshot(consoleConn);
  }
  if (!state?.prompt && state?.motivoSinPrompt !== "login_pendiente" && returnsSent < 2) {
    escribir(
      "     la consola está muda (motivo=" +
        (state?.motivoSinPrompt ?? "?") +
        "): se le manda un Return, como haría el usuario al pulsar Enter",
    );
    consoleConn.socket.emit("terminal:data", "\r");
    returnsSent += 1;
    deadline = Date.now() + AFTER_RETURN_WAIT_MS;
    while (
      Date.now() < deadline &&
      !state?.prompt &&
      state?.motivoSinPrompt !== "login_pendiente"
    ) {
      await sleep(400);
      state = getSnapshot(consoleConn);
    }
  }
  escribir(
    `     la consola pide: ${JSON.stringify(state?.pendiente ?? state?.ultimaLinea ?? "(nada)")}` +
      `  motivo=${state?.motivoSinPrompt ?? "-"}  prompt=${JSON.stringify(state?.prompt ?? null)}`,
  );

  if (state?.prompt) {
    assertCheck(
      true,
      "la consola ya daba prompt: no hay login que completar",
      `prompt=${JSON.stringify(state.prompt)}`,
    );
    return true;
  }
  if (state?.motivoSinPrompt !== "login_pendiente") {
    assertCheck(
      false,
      "la consola pide autenticación pero este script no tiene credenciales",
      `motivo=${state?.motivoSinPrompt} ultimaLinea=${JSON.stringify(state?.ultimaLinea ?? "")}`,
    );
    return false;
  }

  for (const [label, value, isPassword] of [
    ["usuario", username, false],
    ["password", password ?? "", true],
  ] as const) {
    deadline = Date.now() + CREDENTIALS_WAIT_MS;
    while (Date.now() < deadline) {
      const current = getSnapshot(consoleConn);
      if (current?.motivoSinPrompt !== "login_pendiente") break;
      const asksPassword = /pass\s?word|passphrase/i.test(String(current.pendiente ?? ""));
      if (asksPassword === isPassword) break;
      await sleep(300);
    }
    const before = getSnapshot(consoleConn);
    if (before?.motivoSinPrompt !== "login_pendiente") {
      assertCheck(
        true,
        `la consola no llegó a pedir ${label}`,
        `motivo=${before?.motivoSinPrompt} prompt=${JSON.stringify(before?.prompt ?? null)}`,
      );
      break;
    }
    consoleConn.socket.emit("terminal:data", `${value}\r`);
    escribir(`     ${label} enviado (la consola pedía ${JSON.stringify(before?.pendiente)})`);
    await sleep(800);
  }

  const ready = await esperarPrompt(consoleConn.session, CREDENTIALS_WAIT_MS);
  assertCheck(
    Boolean(ready.prompt) && ready.promptWaitMessage === null,
    "tras autenticarse la consola da prompt: " +
      `prompt=${JSON.stringify(ready.prompt)} ${ready.promptWaitMessage ?? ""}`,
    `no apareció prompt tras autenticarse: ${ready.promptWaitMessage ?? "sin motivo"}`,
  );
  if (!ready.prompt) {
    escribir(
      "     últimos datos de la consola: " +
        JSON.stringify((ready.lastLines ?? []).slice(-8).join(" | ").slice(-260)),
    );
    return false;
  }
  return true;
}

async function closeCarefully(consoleConn: ConsolaConectada): Promise<void> {
  const exitCmd = IS_CISCO ? "exit" : "/quit";
  escribir("     cierre con cuidado: se pide al equipo que cierre su sesión con '" + exitCmd + "'");
  try {
    consoleConn.socket.emit("terminal:data", `${exitCmd}\r`);
  } catch {
  }
  await new Promise((r) => setTimeout(r, 2_000));
  await consoleConn.cerrar();
  await new Promise((r) => setTimeout(r, 500));
}

async function main() {
  const backendPort = await arrancarBackend();
  const url = "http://127.0.0.1:" + backendPort;
  const admin = await iniciarSesionAdmin(url);

  const consoleConn = await conectarConsola(url, admin.token, {
    type: "TELNET",
    host,
    port: Number(portArg),
    name: "conf-" + STAMP,
    typeDevice: deviceType,
    ...(username ? { user: username } : {}),
    ...(password ? { password } : {}),
  });

  const runConfig = (options: any) =>
    comoAdmin(admin, () =>
      terminalSessionHub.runConfigDetailed(consoleConn.session, { ...WAIT_OPTS, ...options }),
    );
  const sendCmd = (command: string) =>
    comoAdmin(admin, () =>
      terminalSessionHub.sendCommandDetailed(consoleConn.session, command, { maxMs: 30_000 }),
    );

  escribir("=== " + brand.toUpperCase() + "  " + host + ":" + portArg + "  (" + deviceType + ")");
  escribir(
    IS_CISCO
      ? "     el Cisco 7200 de GNS3 entrega el prompt tras un Return de arranque (lo pone el hub)."
      : "     el CHR por telnet negocia el protocolo y está mudo hasta que se le manda un Return.",
  );

  const authenticated = await authenticateIfNeeded(consoleConn);

  if (authenticated) {
    const batch = IS_CISCO
      ? ["interface FastEthernet0/0", "description " + STAMP]
      : ["/system identity", "set name=" + STAMP];

    const dryPlan = await runConfig({ comandos: batch, dryRun: true });
    escribir("-- 1) dryRun (no debe escribir nada) --");
    assertCheck(dryPlan.plan != null, "devuelve un plan", JSON.stringify(dryPlan.plan).slice(0, 200));
    assertCheck(
      dryPlan.motivoSinPrompt === null && dryPlan.motivoAborto === null,
      "la consola está lista para ejecutar el plan",
      `modo=${dryPlan.modoFinal} motivoSinPrompt=${dryPlan.motivoSinPrompt} ${dryPlan.motivoAbortoTexto ?? ""}`,
    );
    assertCheck(
      dryPlan.modoIndeterminado === true || dryPlan.modoFinal != null,
      "declara el modo de configuración",
      String(dryPlan.modoFinal),
    );
    escribir("     omitidas: " + JSON.stringify(dryPlan.plan?.omitidas ?? []).slice(0, 240));

    const applyRes = await runConfig({ comandos: batch });
    escribir("-- 2) aplicar --");
    assertCheck(
      !applyRes.abortado,
      "el lote se aplicó",
      JSON.stringify(applyRes.motivoAbortoTexto ?? ""),
    );
    escribir("     vendor=" + applyRes.vendor + "  modo=" + applyRes.modoFinal);
    escribir(
      "     salioDeConfig=" +
        applyRes.salioDeConfig +
        "  intentosSalida=" +
        applyRes.intentosSalida,
    );
    escribir(
      "     pasos: " +
        JSON.stringify(
          (applyRes.pasos ?? []).map((x: any) => ({ c: x.comando, e: x.estado ?? x.enviado ?? null })),
        ).slice(0, 400),
    );
    if (applyRes.avisoSalida) escribir("     AVISO SALIDA: " + applyRes.avisoSalida);
    if (applyRes.dialogos?.length) {
      escribir("     DIALOGOS: " + JSON.stringify(applyRes.dialogos).slice(0, 400));
    }
    assertCheck(
      applyRes.dialogoPendiente == null,
      "no quedó ningún diálogo pendiente",
      JSON.stringify(applyRes.dialogoPendiente ?? null),
    );
    assertCheck(
      applyRes.salioDeConfig === true && applyRes.modoFinal !== "config",
      "la consola salió del modo configuración",
      `salioDeConfig=${applyRes.salioDeConfig} modoFinal=${applyRes.modoFinal} ` +
        `promptFinal=${JSON.stringify(applyRes.promptFinal)} intentosSalida=${applyRes.intentosSalida}`,
    );

    const readCmd = IS_CISCO
      ? "show running-config | include description"
      : "/system identity print";
    const readRes = await sendCmd(readCmd);
    escribir("-- 3) verificar leyendo del equipo (" + readCmd + ") --");
    escribir("     salida: " + JSON.stringify(readRes.output.slice(0, 300)));
    assertCheck(
      /PT-PROBA/i.test(readRes.output),
      "la marca aparece en la lectura",
      JSON.stringify(readRes.output.slice(0, 260)),
    );

    const undoRes = IS_CISCO
      ? await runConfig({ comandos: ["interface FastEthernet0/0", "no description"] })
      : await runConfig({ comandos: ["/system identity", "set name=MikroTik"] });
    escribir("-- 4) deshacer --");
    assertCheck(!undoRes.abortado, "el lote de limpieza se aplicó", String(undoRes.motivoAbortoTexto ?? ""));
    assertCheck(
      undoRes.salioDeConfig === true,
      "la consola volvió a salir del modo configuración al deshacer",
      `salioDeConfig=${undoRes.salioDeConfig} modoFinal=${undoRes.modoFinal} ` +
        `promptFinal=${JSON.stringify(undoRes.promptFinal)}`,
    );

    const readRes2 = await sendCmd(
      IS_CISCO ? "show running-config | include description" : "/system identity print",
    );
    escribir("     lectura final: " + JSON.stringify(readRes2.output.slice(0, 220)));
    assertCheck(
      !/PT-PROBA/i.test(readRes2.output),
      "la marca ya no está",
      JSON.stringify(readRes2.output.slice(0, 200)),
    );

    const normalize = (promptValue: string | null) => String(promptValue ?? "").replace(/\s+/g, " ").trim();
    const expectedRoot = IS_CISCO ? /^R1#(\s|$)/ : /^\[[^\]]*@MikroTik\]\s*>/;
    const isInMenu = (promptValue: string | null) => /^\[[^\]]*@\S*\]\s*\/\S+/.test(normalize(promptValue));
    const isAtRoot = (promptValue: string | null) =>
      Boolean(promptValue) &&
      expectedRoot.test(normalize(promptValue)) &&
      !/\(config/.test(normalize(promptValue)) &&
      !isInMenu(promptValue);

    let finalPrompt = await esperarPrompt(consoleConn.session, 20_000);
    escribir(
      "     prompt tras el ciclo: " +
        JSON.stringify(normalize(finalPrompt.prompt)) +
        "  (modo=" +
        applyRes.modoFinal +
        ", salioDeConfig=" +
        applyRes.salioDeConfig +
        ", intentosSalida=" +
        applyRes.intentosSalida +
        ", motivoAborto=" +
        applyRes.motivoAborto +
        ")",
    );
    if (!isAtRoot(finalPrompt.prompt) && isInMenu(finalPrompt.prompt)) {
      escribir(
        "     el motor dejó la consola en un menú (" +
          applyRes.motivoAborto +
          "); se sube a mano con '..', que es lo que documenta el propio equipo",
      );
      for (let level = 0; level < 4 && isInMenu(getSnapshot(consoleConn)?.prompt ?? null); level += 1) {
        consoleConn.socket.emit("terminal:data", "..\r");
        escribir(`     '..' enviado (nivel ${level + 1})`);
        await sleep(1_500);
      }
      finalPrompt = await esperarPrompt(consoleConn.session, 15_000);
    }

    assertCheck(
      isAtRoot(finalPrompt.prompt) && finalPrompt.promptWaitMessage === null,
      "la consola queda en el prompt RAÍZ, no en un sub-modo: " +
        `prompt="${normalize(finalPrompt.prompt)}" vendor=${finalPrompt.vendor} ${finalPrompt.promptWaitMessage ?? ""}`,
      `prompt="${normalize(finalPrompt.prompt)}" (esperado ${expectedRoot}): la consola no volvió a su ` +
        `prompt raíz — motivoSinPrompt=${finalPrompt.motivoSinPrompt} ` +
        `ultimaLinea=${JSON.stringify(normalize(finalPrompt.ultimaLinea))}`,
    );
    escribir(
      "     prompt final: " +
        JSON.stringify(normalize(finalPrompt.prompt)) +
        "  (modo=" +
        applyRes.modoFinal +
        ", motivoSinPrompt=" +
        finalPrompt.motivoSinPrompt +
        ")",
    );
    escribir("     últimas líneas: " + JSON.stringify(finalPrompt.lastLines.slice(-4).map((l) => l.slice(-90))));
  }

  escribir(failures === 0 ? "RESULTADO: TODO OK" : "RESULTADO: " + failures + " FALLO(S)");
  await closeCarefully(consoleConn);
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
