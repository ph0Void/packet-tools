import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  diagnosticoSinPromptDe,
  snapshotPromptSatisfies,
  terminalSessionHub,
  type TerminalSession,
  type TerminalSessionSnapshot,
  type TerminalCommandResult,
} from "@/sockets/TerminalSessionHub";
import { resolveVendorForConsole } from "@/agent/terminal/vendorResolver";
import { guiaDeLecturaCanonica } from "@/agent/security/CanonicalReads";
import { requestContext } from "@/utils/RequestContext";

const DEFAULT_LINES = 40;
const MAX_LINES = 100;

function resolveActiveTerminal(): {
  session: TerminalSession;
  snapshot: TerminalSessionSnapshot;
} | null {
  const ctx = requestContext.getStore();
  if (!ctx?.id) return null;

  if (ctx.connectionProviderId && ctx.connectionProtocol !== "SIMULATION") {
    const match = terminalSessionHub.findMatch(
      ctx.id,
      ctx.connectionProviderId,
      ctx.connectionFingerprint ?? null,
    );
    if (!match) return null;
    const snapshot = terminalSessionHub.getSnapshotForUser(
      ctx.id,
      match.socketId,
    );
    if (!snapshot || !snapshot.alive) return null;
    const session = terminalSessionHub.get(snapshot.sessionId);
    if (!session) return null;
    return { session, snapshot };
  }

  let snapshot = ctx.terminalSessionId
    ? (terminalSessionHub.getSnapshotForUser(ctx.id, ctx.terminalSessionId) ??
      terminalSessionHub.getActiveSnapshot(ctx.id))
    : terminalSessionHub.getActiveSnapshot(ctx.id);
  if (!snapshot) return null;

  if (!snapshot.alive) {
    const viva = terminalSessionHub.getActiveSnapshot(ctx.id);
    if (!viva || !viva.alive) return null;
    snapshot = viva;
  }

  const session = terminalSessionHub.get(snapshot.sessionId);
  if (!session) return null;

  return { session, snapshot };
}

const HINT_CONEXION_DIRECTA =
  " Si este turno viene del chat general (sin consola), usa las herramientas de conexión directa (executeSshCommands / executeTelnetCommands / sendSerialCommand) con el providerId del dispositivo.";

const HINT_CONEXION_OBJETIVO_SIN_CONSOLA =
  " La conexión seleccionada no tiene consola abierta: indica al usuario que conecte la consola de ese dispositivo y espera; no abras conexiones directas.";

function terminalRequired(mensaje: string): string {
  const ctx = requestContext.getStore();
  const suggestedProviderId =
    ctx?.connectionProviderId ?? ctx?.mentionedProviderId ?? null;

  const mensajeFinal = ctx?.connectionProviderId
    ? `${mensaje}${HINT_CONEXION_OBJETIVO_SIN_CONSOLA}`
    : `${mensaje}${HINT_CONEXION_DIRECTA}`;
  ctx?.approvalChannel?.emit("agent_progress", {
    phase: "terminal_required",
    detail: mensajeFinal,
  });
  return JSON.stringify({
    success: false,
    code: "TERMINAL_REQUIRED",
    message: mensajeFinal,
    suggestedProviderId,
  });
}

function emitProgress(
  phase: string,
  detail?: string,
  extra?: Record<string, unknown>,
): void {
  const canal = requestContext.getStore()?.approvalChannel;
  canal?.emit("agent_progress", { phase, detail, ...extra });
}

async function vendorDeSesion(
  snapshot: TerminalSessionSnapshot,
): Promise<string> {
  const perfil = await resolveVendorForConsole({
    providerId: snapshot.providerId,
    prompt: snapshot.prompt,
  });
  return perfil.id;
}

function bloqueSinPrompt(error: unknown): Record<string, unknown> | null {
  const diag = diagnosticoSinPromptDe(error);
  if (!diag) return null;
  return {
    motivoSinPrompt: diag.motivo,
    sinPrompt: {
      motivo: diag.motivo,
      pendiente: diag.pendiente,
      ultimaLinea: diag.ultimaLinea,
      consejo: diag.consejo,
    },
  };
}

const readTerminalTool = tool(
  async ({ lines }) => {
    emitProgress("reading", "Leyendo la salida reciente de la consola.");

    const activo = resolveActiveTerminal();
    if (!activo) {
      return terminalRequired(
        "No hay ninguna consola conectada. Abre una terminal SSH, Telnet o Serial para que el agente pueda operar sobre ella.",
      );
    }

    const cantidad = Math.min(Math.max(lines ?? DEFAULT_LINES, 1), MAX_LINES);
    const { snapshot } = activo;
    return JSON.stringify({
      success: true,
      sessionId: snapshot.sessionId,
      deviceName: snapshot.deviceName,
      protocol: snapshot.protocol,
      alive: snapshot.alive,
      prompt: snapshot.prompt,
      vendor: await vendorDeSesion(snapshot),

      motivoSinPrompt: snapshot.motivoSinPrompt,
      pendiente: snapshot.pendiente,
      ultimaLinea: snapshot.ultimaLinea,
      lines: snapshot.lastLines.slice(-cantidad),
    });
  },
  {
    name: "read_terminal",
    description:
      "Read the recent output of the user's active console (SSH, Telnet or serial) to inspect its state before sending the next command.",
    schema: z.object({
      lines: z
        .number()
        .int()
        .min(1)
        .max(MAX_LINES)
        .optional()
        .default(DEFAULT_LINES)
        .describe(
          `Number of recent lines to return (1-${MAX_LINES}, default ${DEFAULT_LINES})`,
        ),
    }),
  },
);

const getTerminalStatusTool = tool(
  async () => {
    const activo = resolveActiveTerminal();
    if (!activo) {

      emitProgress("disconnected");
      return JSON.stringify({
        alive: false,
        protocol: null,
        deviceName: null,
        prompt: null,
        sessionId: null,
        code: "TERMINAL_REQUIRED",
        message: "No hay ninguna consola de terminal activa en este momento.",
      });
    }

    const { snapshot } = activo;

    if (snapshot.alive) {
      emitProgress("connected", snapshot.deviceName ?? undefined);
    } else {
      emitProgress("disconnected");
    }

    const vendor = await vendorDeSesion(snapshot);
    return JSON.stringify({
      alive: snapshot.alive,
      protocol: snapshot.protocol,
      deviceName: snapshot.deviceName,
      prompt: snapshot.prompt,
      sessionId: snapshot.sessionId,
      vendor,

      motivoSinPrompt: snapshot.motivoSinPrompt,
      pendiente: snapshot.pendiente,

      lecturasCanonicas: guiaDeLecturaCanonica(vendor),
    });
  },
  {
    name: "get_terminal_status",
    description:
      "Report whether the user has an active console and return its protocol, device, current prompt, liveness, the vendor and the canonical read-only commands for that vendor. Call it before sending the first command.",
    schema: z.object({}),
  },
);

const waitForPromptTool = tool(
  async ({ expected, timeoutMs }) => {
    emitProgress(
      "waiting_prompt",
      expected
        ? `Esperando un prompt que coincida con "${expected}".`
        : "Esperando el prompt estable de la consola.",
    );

    const activo = resolveActiveTerminal();
    if (!activo) {
      return terminalRequired(
        "No hay ninguna consola conectada sobre la que esperar un prompt.",
      );
    }

    const { session } = activo;
    const snapshot = await terminalSessionHub.waitForPrompt(session, {
      expected,
      timeoutMs,
    });

    const timedOut = !snapshotPromptSatisfies(snapshot, expected);

    return JSON.stringify({
      success: true,
      sessionId: snapshot.sessionId,
      prompt: snapshot.prompt,
      alive: snapshot.alive,
      timedOut,
      vendor: await vendorDeSesion(snapshot),
      lines: snapshot.lastLines.slice(-DEFAULT_LINES),

      promptWaitMessage: snapshot.promptWaitMessage,

      motivoSinPrompt: snapshot.motivoSinPrompt,
      pendiente: snapshot.pendiente,

      despertar: snapshot.despertar,
    });
  },
  {
    name: "wait_for_prompt",
    description:
      "Wait until the active console shows a stable prompt again (e.g. after a long command). 'expected' is matched against the prompt as a whole prompt or as a complete token, never as a substring: asking for 'R1' does NOT match 'core-r1#'. Works with every vendor's prompt shape ('R1#', 'R1(config)#', '<Huawei>', '[R1-GigabitEthernet0/0]', '[admin@core-r1] > /interface', 'user@vsrx>', '(host) (config) #', 'vyos@vyos:~$'). If the console has no prompt yet but the device is asking for a keystroke at boot ('Press RETURN to get started', 'Please Press ENTER'), a bare Return is sent to wake it up and the wait continues; it is reported in 'despertar' ({ intentos, motivoFinal }). A console waiting for an ANSWER ('[yes/no]', '[Y/N]', '(y/n)', JunOS '[yes,no]', 'Password:', 'Username:') is never woken up: there the reply is the user's. Read 'timedOut' and 'promptWaitMessage' before assuming the device is stuck.",
    schema: z.object({
      expected: z
        .string()
        .optional()
        .describe(
          "Prompt text to require, matched as a full prompt (e.g. 'R1(config)#') or as a complete token (e.g. 'R1', which also matches 'R1(config)#' but never 'core-r1#'). Optional: any stable prompt counts.",
        ),
      timeoutMs: z
        .number()
        .int()
        .min(0)
        .max(60_000)
        .optional()
        .describe(
          "Max wait in milliseconds (default 10000, max 60000)",
        ),
    }),
  },
);

const sendCommandTool = tool(
  async ({ command, waitForPromptMs, timeoutMs }) => {
    emitProgress(
      "sending",
      `Enviando comando a la consola: ${command}`,
      { command },
    );

    const activo = resolveActiveTerminal();
    if (!activo) {
      return terminalRequired(
        "No hay ninguna consola conectada. Abre una terminal SSH, Telnet o Serial para enviar comandos.",
      );
    }

    const { session, snapshot } = activo;

    const maxMs = waitForPromptMs ?? timeoutMs;

    let resultado: TerminalCommandResult;
    try {
      resultado = await terminalSessionHub.sendCommandDetailed(
        session,
        command,
        maxMs !== undefined ? { maxMs } : undefined,
      );
    } catch (error: any) {

      return JSON.stringify({
        success: false,
        message:
          error?.message ?? "No se pudo enviar el comando a la consola.",
        ...(bloqueSinPrompt(error) ?? {}),
      });
    }

    const actualizado = terminalSessionHub.getSnapshot(snapshot.sessionId);
    const base = {
      sessionId: snapshot.sessionId,
      command,

      executed: resultado.executed,
      removed: resultado.removed,
      output: resultado.output,
      prompt: actualizado?.prompt ?? null,
      endReason: resultado.endReason,
      timedOut: resultado.timedOut,
      elapsedMs: resultado.elapsedMs,

      paged: resultado.paged,
      pages: resultado.pages,
      pagerVariant: resultado.pagerVariant,

      recortado: resultado.recortado,
      motivoCorte: resultado.motivoCorte,

      despertar: resultado.despertar,
    };

    if (resultado.executed.length === 0) {
      return JSON.stringify({
        ...base,
        success: false,
        code: "NO_COMMANDS_EXECUTED",
        removedReason: resultado.removedReason,
        message: resultado.removed.length
          ? `No se ejecutó nada: '${resultado.removed.join(", ")}' se descartó porque cerraría la sesión interactiva del usuario. Usa 'end'/'exit' solo si el prompt está en un sub-modo.`
          : "No se ejecutó nada: el comando estaba vacío o solo contenía líneas en blanco.",
      });
    }

    if (!resultado.output.trim()) {
      return JSON.stringify({
        ...base,
        success: false,
        code: "NO_OUTPUT",
        message: `El comando se envió a la consola pero no volvió ninguna salida en ${resultado.elapsedMs} ms${resultado.timedOut ? " (plazo agotado)" : ""}. No des por hecho que se ejecutó: comprueba la consola con read_terminal antes de reintentarlo.`,
      });
    }

    const avisos: string[] = [];
    if (resultado.removed.length > 0) {
      avisos.push(
        `No se enviaron ${resultado.removed.length} comando(s): ${resultado.removed.join(", ")} (${resultado.removedReason}).`,
      );
    }

    if (resultado.paged) {
      avisos.push(
        `El equipo paginó su salida: se le pagaron ${resultado.pages} página(s) con la tecla espacio para poder leerla entera (marca: ${resultado.pagerVariant ?? "paginador"}).`,
      );
    }

    if (resultado.recortado) {
      avisos.push(
        "La salida se limpió del eco del comando (la consola lo repinta carácter a carácter), así que `output` es solo la salida real.",
      );
    } else if (resultado.motivoCorte) {
      avisos.push(
        `No se pudo quitar el eco del comando (motivo: ${resultado.motivoCorte}); ` +
          "`output` puede incluirlo y no hay que interpretarlo como salida del equipo.",
      );
    }
    if (resultado.despertar && resultado.despertar.intentos > 0) {
      avisos.push(
        `La consola no daba prompt y hubo que despertarla con ${resultado.despertar.intentos} Return(s) antes de enviar nada.` +
          (resultado.despertar.motivoFinal
            ? ` Al final ${resultado.despertar.motivoFinal}.`
            : ""),
      );
    }
    if (resultado.endReason !== "idle") {

      const cola =
        resultado.endReason === "pending" && resultado.paged
          ? " (el paginador se quedó esperando más páginas)"
          : "";
      avisos.push(
        `La captura terminó por '${resultado.endReason}'${resultado.pendingInput ? ` (${resultado.pendingInput})` : ""}${cola}: la salida puede estar incompleta.`,
      );
    }

    return JSON.stringify({
      ...base,
      success: true,
      removedReason: resultado.removedReason,
      warning: avisos.length ? avisos.join(" ") : undefined,
    });
  },
  {
    name: "send_command",
    description:
      "Send one CLI command to the user's active console and return the captured output. It always operates on the open console (never opens new connections) and must never close the session (exit, quit, logout, disconnect, close). Vendor-neutral: the console prompt, the output trimming and the pager handling work the same on Cisco IOS/IOS-XE/NX-OS ('R1#'), Huawei VRP ('<Huawei>', '[R1-GigabitEthernet0/0]'), MikroTik ('[admin@core-r1] >'), Juniper JunOS ('user@vsrx>'), ArubaOS ('(host) #'), VyOS ('vyos@vyos:~$') or Fortinet ('FGT #'). If the device paginates its output (pager marks such as '--More--', '---- More ----', '---(more)---', '-More-', '[Q|quit]'), every page is paid automatically with the space key, so the returned output is the whole command output: 'paged'/'pages'/'pagerVariant' report how many pages were paged through, and 'paged: true' with 'endReason: pending' means the pager stopped responding (output incomplete), not that the device hung. 'recortado'/'motivoCorte' report whether the echoed command was trimmed out of 'output' (some CLIs, RouterOS above all, repaint the prompt on every keystroke and flood the buffer with the echo): with 'recortado: true' the output is clean, and with a non-null 'motivoCorte' the echo may still be inside it. 'despertar' is non-null when the console had no prompt and a bare Return had to be sent to wake it up (some devices print 'Press RETURN to get started' at boot). The command is never echoed back with a confirmation prompt left unanswered: a pending [confirm]/[yes/no]/[Y/N]/(y/n)/[yes,no] is left for the user. If the console has no prompt nothing is written and the failure comes back with 'motivoSinPrompt' ('login_pendiente', 'arrancando', 'dialogo_pendiente', 'sin_salida', 'sesion_caida' or 'desconocido') plus 'sinPrompt.consejo': read it instead of guessing, and remember the agent NEVER types a login - a 'Login:'/'Password:' on screen means the user has to authenticate in the terminal and retry.",
    schema: z.object({
      command: z.string().describe("CLI command to send to the active console"),
      waitForPromptMs: z
        .number()
        .int()
        .min(0)
        .max(60_000)
        .optional()
        .describe("Max wait for output in milliseconds"),
      timeoutMs: z
        .number()
        .int()
        .min(0)
        .max(60_000)
        .optional()
        .describe("Alias of waitForPromptMs (backwards compatibility)"),
    }),
  },
);

function recortarParaElModelo(texto: string, max = 1_200): string {
  const limpio = String(texto ?? "");
  return limpio.length > max
    ? `${limpio.slice(0, max)}\n… [recortado: ${limpio.length} chars en total]`
    : limpio;
}

const configureDeviceTool = tool(
  async ({ commands, save, dryRun, verifyCommands, waitForPromptMs, timeoutMs }) => {
    const activo = resolveActiveTerminal();
    if (!activo) {
      return terminalRequired(
        "No hay ninguna consola conectada. Abre una terminal SSH, Telnet o Serial para poder configurar el equipo.",
      );
    }

    const { session, snapshot } = activo;
    const maxMs = waitForPromptMs ?? timeoutMs;
    const lote = commands.map((linea) => String(linea ?? "").trim()).filter(Boolean);
    emitProgress(

      dryRun ? "reading" : "configuring",
      dryRun
        ? `Calculando el plan de configuración para ${snapshot.deviceName ?? "el equipo"} (sin escribir nada).`
        : `Configurando ${snapshot.deviceName ?? "el equipo"} con ${lote.length} comando(s).`,
      { commands: lote },
    );

    let resultado: Awaited<
      ReturnType<typeof terminalSessionHub.runConfigDetailed>
    >;
    try {
      resultado = await terminalSessionHub.runConfigDetailed(session, {
        comandos: lote,
        guardar: save === true,
        dryRun: dryRun === true,
        verifyCommands: (verifyCommands ?? []).map((linea) => String(linea ?? "").trim()).filter(Boolean),
        ...(maxMs !== undefined ? { maxMs } : {}),
      });
    } catch (error: any) {

      return JSON.stringify({
        success: false,
        code: "TERMINAL_NOT_RESPONDING",
        sessionId: snapshot.sessionId,
        deviceName: snapshot.deviceName,
        vendor: snapshot.vendor,
        prompt: snapshot.prompt,
        message:
          error?.message ??
          "No se pudo configurar: la consola no tiene un prompt listo y no se escribió nada.",
        ...(bloqueSinPrompt(error) ?? {}),
      });
    }

    const base = {
      sessionId: snapshot.sessionId,
      deviceName: snapshot.deviceName,
      protocol: snapshot.protocol,

      vendor: resultado.vendor,
      vendorLabel: resultado.vendorLabel,
      dryRun: resultado.dryRun,

      escrito: !resultado.dryRun && resultado.executed.length > 0,

      plan: {
        lineas: resultado.plan.lineas.map((linea) => ({
          fase: linea.fase,
          comando: linea.comando,
          motivo: linea.motivo,
        })),
        omitidas: resultado.plan.omitidas.map((o) => ({ fase: o.fase, porque: o.porque })),
      },

      pasos: resultado.pasos.map((paso) => ({
        fase: paso.fase,
        comando: paso.comando,
        estado: paso.estado,
        output: recortarParaElModelo(paso.output),
        paged: paso.paged,
        pages: paso.pages,
        detail: paso.detalle ?? undefined,
      })),
      dialogos: resultado.dialogos.map((dialogo) => ({
        texto: dialogo.texto,
        tipo: dialogo.tipo,
        fase: dialogo.fase,
        pattern: dialogo.patron,

        respuesta: dialogo.respuesta,
        motivo: dialogo.motivo,
      })),
      dialogoPendiente: resultado.dialogoPendiente
        ? {
            texto: resultado.dialogoPendiente.texto,
            tipo: resultado.dialogoPendiente.tipo,
            motivo: resultado.dialogoPendiente.motivo,
          }
        : null,
      abortado: resultado.abortado,
      motivoAborto: resultado.motivoAborto,
      motivoAbortoTexto: resultado.motivoAbortoTexto,

      salioDeConfig: resultado.salioDeConfig,
      avisoSalida: resultado.avisoSalida,
      intentosSalida: resultado.intentosSalida,
      executed: resultado.executed,
      output: recortarParaElModelo(resultado.output, 4_000),

      modoFinal: resultado.modoFinal,
      modoIndeterminado: resultado.modoIndeterminado,
      promptFinal: resultado.promptFinal,
      entramosEnConfig: resultado.entramosEnConfig,
      guardado: resultado.guardado,

      despertar: resultado.despertar,

      motivoSinPrompt: resultado.motivoSinPrompt,
      pendiente: resultado.pendiente,
      ultimaLinea: resultado.ultimaLinea,
    };

    if (resultado.dryRun) {
      return JSON.stringify({
        ...base,
        success: true,
        code: "PLAN_ONLY",
        verificacion: null,
        message: resultado.motivoAbortoTexto
          ? `Plan calculado SIN escribir nada. ${resultado.motivoAbortoTexto}`
          : `Plan calculado SIN escribir nada: ${resultado.plan.lineas.length} línea(s) que se escribirían ` +
            `y ${resultado.plan.omitidas.length} omitida(s) por el perfil del equipo.`,
      });
    }

    if (resultado.dialogoPendiente) {
      return JSON.stringify({
        ...base,
        success: false,
        code: "DIALOGO_PENDIENTE",
        motivoAborto: resultado.motivoAborto,
        verificacion: null,
        message:
          `La configuración se paró en un diálogo del equipo (${resultado.motivoAborto}). ` +
          `${resultado.motivoAbortoTexto ?? ""} El texto literal del diálogo está en ` +
          "'dialogoPendiente'; lo aplicado hasta ese punto figura en 'pasos' y en 'executed', " +
          "pero NO está verificado: decide con el usuario antes de reintentar.",
      });
    }

    if (resultado.verificacion && !resultado.verificacion.completa) {
      const verificacion = {
        pedidos: resultado.verificacion.pedidos,
        resultados: resultado.verificacion.resultados.map((r) => ({
          comando: r.comando,
          output: recortarParaElModelo(r.output),
          endReason: r.endReason,
        })),
        completa: false,
        motivo: resultado.verificacion.motivo,
      };
      return JSON.stringify({
        ...base,
        success: false,
        code: "NO_VERIFICADO",
        verificacion,
        message:
          "NO VERIFICADO: no se ha podido leer la configuración aplicada. " +
          `${resultado.verificacion.motivo} No des por aplicado lo que no has leído: ` +
          "comprueba con read_terminal antes de dar la tarea por buena.",
      });
    }

    if (resultado.abortado) {
      return JSON.stringify({
        ...base,
        success: false,
        code: "CONFIG_ABORTED",
        motivoAborto: resultado.motivoAborto,
        verificacion: null,
        message:
          `La configuración se paró (${resultado.motivoAborto}). ${resultado.motivoAbortoTexto ?? ""} ` +
          "Lo aplicado hasta ese punto figura en 'pasos' y en 'executed'.",
      });
    }

    if (resultado.verificacion) {
      emitProgress(
        "verifying",
        "Releyendo del equipo lo que se acaba de configurar.",
      );
      return JSON.stringify({
        ...base,
        success: true,
        verificacion: {
          pedidos: resultado.verificacion.pedidos,
          resultados: resultado.verificacion.resultados.map((r) => ({
            comando: r.comando,
            output: recortarParaElModelo(r.output),
            endReason: r.endReason,
          })),
          completa: true,
          motivo: null,
        },
      });
    }

    return JSON.stringify({
      ...base,
      success: true,
      verificacion: null,
      warning: resultado.entramosEnConfig && resultado.modoFinal === "config"
        ? "La consola sigue en modo configuración: el motor no pudo salir (no hay comando declarado para eso en el perfil del equipo). Sal antes de dar la tarea por buena."
        : undefined,
    });
  },
  {
    name: "configure_device",
    description:
      "Apply a batch of configuration commands to the user's active console (SSH, Telnet or serial) and report what really happened, command by command. It always operates on the open console (never opens new connections) and NEVER closes the session. The batch plan comes from the vendor profile detected for that console, so it is vendor-correct on Cisco IOS/IOS-XE/NX-OS, Huawei VRP, MikroTik RouterOS, Juniper JunOS, ArubaOS and generic CLIs: it disables the pager and DNS lookup only if that vendor declares those commands, enters privileged mode ('enable') only if needed, enters configuration mode ('configure terminal' / 'system-view' / 'configure'), sends your commands one per line, optionally saves ('save', optional), and leaves configuration mode on its own. Steps the vendor does not declare are NOT invented: they come back in 'plan.omitidas' with the reason, so an unidentified device is still configurable (the commands go to the current mode). Set 'dryRun' to get that plan with nothing written at all - not a single byte, not even the boot Return - which is the safe way to plan before asking the user. Confirmation dialogs are handled with hard rules: only the confirmation the vendor profile declares as its own is answered (e.g. Cisco 'Destination filename [startup-config]?' is accepted with a bare Return, because the device proposes the filename in brackets), and a question to the user ('[y/n]', '[yes/no]', '[Y/N]', '(y/n)', '[confirm]', 'Are you sure', 'Password:') or a confirmation of something destructive ('reload', 'erase', 'write erase', 'reboot', 'reset', 'factory-reset', 'delete') is NEVER answered: the batch stops there and the dialog is returned to you with its literal text, together with everything that had already been applied. Declared boot dialogs that are not confirmations are cut once with the vendor's abort key and reported. Never pass 'exit', 'quit', 'logout', 'disconnect' or 'close' in 'commands': they would be discarded (closing the user's console is blocked) and the engine leaves configuration mode by itself, only when the prompt really is a sub-mode. Pass 'verifyCommands' with read-only commands ('show ...', 'display ...') to read back what was applied: if that output cannot be read the result says NOT VERIFIED and 'success' is false, because nothing must be assumed applied that was not read. If the console has no prompt nothing at all is written and the reason comes back CLASSIFIED in 'motivoSinPrompt' (with 'sinPrompt.consejo' telling you what to do, and 'sinPrompt.pendiente' quoting what the device is asking for): 'login_pendiente' = the console is asking for credentials ('Login:', 'Username:', 'Password:', 'User:') and the agent NEVER types them for you - the user must authenticate in the terminal and retry, because waiting does not help; 'arrancando' = the device is still booting ('Press RETURN to get started!'), wait and retry; 'dialogo_pendiente' = an open '[yes/no]'/'[confirm]'/'(y/n)' that only the user can answer; 'sin_salida' = the console wrote nothing at all, usually a powered-off device - turn it on first ('setPower' for an emulated node, 'controlGns3NodePower' in GNS3) and wait (there is no auto power-on over telnet); 'sesion_caida' = the terminal session closed; 'desconocido' = the console shows text but nothing recognisable, so NO cause is claimed - read the console with read_terminal instead of guessing.",
    schema: z.object({
      commands: z
        .array(z.string().min(1))
        .min(1)
        .describe(
          "Configuration commands to apply, one command per element (the engine sends them one per line, in order). Never include exit/quit/logout/disconnect/close: they would be discarded and the engine leaves configuration mode by itself.",
        ),
      save: z
        .boolean()
        .optional()
        .describe(
          "Also persist the configuration to non-volatile memory with the vendor's own save command ('write memory', 'save', 'commit'). Omit it when the user did not ask to save.",
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe(
          "Return the plan (preamble, mode, lines, save, exit) without writing a single byte. Use it to plan before asking the user.",
        ),
      verifyCommands: z
        .array(z.string().min(1))
        .optional()
        .describe(
          "Read-only commands used to confirm what was applied (e.g. ['show running-config']). If their output cannot be read, the result reports NOT VERIFIED instead of claiming success.",
        ),
      waitForPromptMs: z
        .number()
        .int()
        .min(0)
        .max(120_000)
        .optional()
        .describe("Max wait per plan line in milliseconds (default 20000)"),
      timeoutMs: z
        .number()
        .int()
        .min(0)
        .max(120_000)
        .optional()
        .describe("Alias of waitForPromptMs (backwards compatibility)"),
    }),
  },
);

export const TERMINAL_TOOLS = [
  readTerminalTool,
  getTerminalStatusTool,
  waitForPromptTool,
  sendCommandTool,
  configureDeviceTool,
];
