
import net from "node:net";
import type { AddressInfo } from "node:net";


export type VariantPaginator =
  | "--More--"
  | "---- More ----"
  | "-More-"
  | "---(more)---"
  | "[Q|quit]"
  | "按Enter继续";


export interface DialogFake {
  
  question: string;
  
  wait?: string;
  
  output?: string;
  
  noAnswers?: boolean;
}


export interface ReplyCommand {
  
  lines?: string[];
  
  pages?: number;
  
  variant?: VariantPaginator;
  
  prefix?: string;
  
  retardoCharMs?: number;
  
  retardoInicialMs?: number;
  
  silencioso?: boolean;
  
  promptFinal?: string | null;
  
  colgado?: boolean;
  
  teclasPerdidas?: number;
}


export interface EscenaMockConsole {
  
  prompt: string | null;
  
  banner?: string;
  
  login?: {
    
    user?: string;
    
    password?: string;
    
    userValid: string;
    passwordValid: string;
    
    promptPostLogin?: string | null;
  };
  
  commands?: Record<string, ReplyCommand>;
  
  outputOfConfig?: {
    
    command: string;
    
    niveles: readonly string[];
  };
  
  dialogos?: Record<string, DialogFake>;
  
  byDefecto?: ReplyCommand;
  
  echo?: boolean;
  
  echoRepintado?: boolean;
  
  echoSeparador?: string;
  
  promptTrasReturn?: boolean;
  
  paginatorColgado?: boolean;
  
  retardoSaludoMs?: number;
}


export interface DialogRecibido {
  
  question: string;
  
  recibida: string | null;
  
  esperada: string | null;
}


export interface ConnectionMockConsole {
  
  lines: string[];
  
  raw: string;
  
  teclasPaginator: number;
  
  teclasPerdidas: number;
  
  returns: number;
  
  dialogos: DialogRecibido[];
  
  cerrada: boolean;
}


export interface MockConsoleFake {
  
  port: number;
  
  connections: ConnectionMockConsole[];
  
  cerrar(): Promise<void>;
}


const RETARDO_SALUDO_MS = 250;

const PREFIX_PAGE = "dato";

const LINES_BY_PAGE = 6;

const RELLENO_LINE = "x".repeat(24);

const MARKER_FINAL = "FINAL";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function pageOf(prefix: string, index: number, last: boolean): string {
  const lines: string[] = [];
  for (let k = 1; k <= LINES_BY_PAGE; k += 1) {
    lines.push(`${prefix}-p${index}-l${k} ${RELLENO_LINE}`);
  }
  if (last) lines.push(`${prefix}-${MARKER_FINAL}-p${index}`);
  return lines.join("\r\n");
}



export async function createMockConsoleFake(escena: EscenaMockConsole): Promise<MockConsoleFake> {
  const connections: ConnectionMockConsole[] = [];
  const sockets = new Set<net.Socket>();
  
  const timers = new Set<ReturnType<typeof setTimeout>>();
  
  const retardoSaludo = escena.retardoSaludoMs ?? RETARDO_SALUDO_MS;
  
  const neverPrompt = escena.prompt === null;


  const waitPrimerReturn = escena.promptTrasReturn === true;

  
  const programar = (fn: () => void, ms: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);

    (timer as unknown as { unref?: () => void }).unref?.();
    timers.add(timer);
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    const record: ConnectionMockConsole = {
      lines: [],
      raw: "",
      teclasPaginator: 0,
      teclasPerdidas: 0,
      returns: 0,
      dialogos: [],
      cerrada: false,
    };
    connections.push(record);

    
    let promptCurrent: string | null = escena.prompt;
    
    let promptYaPintado = false;
    
    let line = "";
    
    let waitingPaginator = false;


    let waitingDialog: { definicion: DialogFake; record: DialogRecibido } | null = null;
    
    let etapaLogin: "usuario" | "password" | "listo" = escena.login ? "usuario" : "listo";
    
    let indexOutput = 0;

    const write = (text: string): void => {
      if (!socket.destroyed) socket.write(text);
    };

    const pintarPrompt = (): void => {
      if (neverPrompt || promptCurrent === null) return;

      if (waitPrimerReturn && !promptYaPintado) return;
      promptYaPintado = true;
      write(promptCurrent);
    };

    
    const emitSlow = (text: string, ms: number): void => {
      if (ms <= 0) {
        write(text);
        return;
      }
      let i = 0;
      const paso = (): void => {
        if (i >= text.length || socket.destroyed) return;
        write(text[i]);
        i += 1;
        programar(paso, ms);
      };
      programar(paso, ms);
    };

    
    const emitSimple = (r: ReplyCommand): void => {
      if (r.lines && r.lines.length > 0) {
        emitSlow(r.lines.join("\r\n") + "\r\n", r.retardoCharMs ?? 0);
      }
      if (r.promptFinal !== undefined) promptCurrent = r.promptFinal;
      pintarPrompt();
    };

    
    let pageIndex = 0;
    let pageTotal = 0;
    let pageVariant: VariantPaginator = "--More--";
    let pagePrefix = PREFIX_PAGE;
    let pageColgada = false;

    
    const emitPage = (): void => {
      const last = pageIndex >= pageTotal;
      write(`${pageOf(pagePrefix, pageIndex, last)}\r\n`);
      if (last) {
        waitingPaginator = false;
        pintarPrompt();
        return;
      }

      write(pageVariant);
      waitingPaginator = true;
    };

    
    const nextPage = (): void => {
      if (socket.destroyed) return;
      write("\r\n");
      pageIndex += 1;
      programar(emitPage, 5);
    };

    
    const iniciarPagination = (r: ReplyCommand): void => {
      pageIndex = 1;
      pageTotal = Math.max(1, r.pages ?? 1);
      pageVariant = r.variant ?? "--More--";
      pagePrefix = r.prefix ?? PREFIX_PAGE;
      pageColgada = r.colgado ?? escena.paginatorColgado ?? false;
      if (r.promptFinal !== undefined) promptCurrent = r.promptFinal;
      programar(emitPage, 5);
    };



    const ecosear = (text: string): void => {
      if (escena.echo === false) return;
      const separador = escena.echoSeparador ?? " ";
      if (escena.echoRepintado !== true) {
        write(`${text}\r\n`);
        return;
      }
      let acumulado = "";
      for (const ch of text) {
        acumulado += ch;
        write(
          `\r\x1b[36m${promptCurrent ?? ""}\x1b[m${separador}\x1b[31m${acumulado}\x1b[K\r`,
        );
      }
      write("\n");
    };

    const responder = (command: string): void => {
      const r = escena.commands?.[command] ?? escena.byDefecto;
      if (!r) {
        write(`% Comando desconocido: ${command}\r\n`);
        pintarPrompt();
        return;
      }

      const perdidas = r.teclasPerdidas ?? 0;
      if (perdidas !== 0) {
        if (perdidas > 0) r.teclasPerdidas = perdidas - 1;
        record.teclasPerdidas += 1;
        pintarPrompt();
        return;
      }

      const output = escena.outputOfConfig;
      if (output && output.command === command && output.niveles.length > 0) {
        const last = output.niveles.length - 1;
        promptCurrent = output.niveles[indexOutput <= last ? indexOutput : last];
        indexOutput += 1;
        pintarPrompt();
        return;
      }
      const arrancar = (): void => {
        if (socket.destroyed) return;
        if (r.silencioso) {
          if (r.promptFinal !== undefined) promptCurrent = r.promptFinal;
          pintarPrompt();
          return;
        }
        if (r.pages && r.pages > 0) iniciarPagination(r);
        else emitSimple(r);
      };
      const wait = r.retardoInicialMs ?? 0;
      if (wait > 0) programar(arrancar, wait);
      else arrancar();
    };

    
    const pasoLogin = (text: string): void => {
      const login = escena.login;
      if (!login) return;
      if (etapaLogin === "usuario") {
        if (text !== login.userValid) {
          write(`\r\n% Login incorrecto\r\n${login.user ?? "Username"}: `);
          return;
        }
        write(`\r\n${login.password ?? "Password"}: `);
        etapaLogin = "password";
        return;
      }
      if (text !== login.passwordValid) {
        write(`\r\n% Login incorrecto\r\n${login.user ?? "Username"}: `);
        etapaLogin = "usuario";
        return;
      }

      write(`\r\n`);
      etapaLogin = "listo";
      if (login.promptPostLogin !== undefined) promptCurrent = login.promptPostLogin;
      pintarPrompt();
    };

    
    const procesarLine = (text: string): void => {

      if (waitingDialog) {
        const current = waitingDialog;
        if (current.record.recibida === null) {
          current.record.recibida = text;
        }
        const esperada = current.definicion.wait ?? "";

        if (current.definicion.noAnswers === true) return;
        if (text !== esperada) return;
        waitingDialog = null;
        write(`\r\n${current.definicion.output ?? ""}\r\n`);
        pintarPrompt();
        return;
      }
      record.lines.push(text);
      if (etapaLogin !== "listo") {
        pasoLogin(text);
        return;
      }
      if (escena.echo !== false) ecosear(text);

      const scriptDialog = escena.dialogos?.[text];
      if (scriptDialog) {
        const recordDialog: DialogRecibido = {
          question: scriptDialog.question,
          recibida: null,
          esperada: scriptDialog.wait ?? "",
        };
        record.dialogos.push(recordDialog);
        waitingDialog = { definicion: scriptDialog, record: recordDialog };
        write(`\r\n${scriptDialog.question}`);
        return;
      }
      responder(text);
    };

    socket.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      record.raw += text;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === "\r" || ch === "\n") {

          if (ch === "\n" && text[i - 1] === "\r") continue;
          const escrita = line.trim();
          line = "";
          if (escrita) {
            procesarLine(escrita);
            continue;
          }

          record.returns += 1;
          if (waitingDialog) {
            procesarLine("");
            continue;
          }
          if (waitPrimerReturn && !promptYaPintado && etapaLogin === "listo") {

            promptYaPintado = true;
            programar(pintarPrompt, 5);
          }
          continue;
        }

        if (waitingPaginator && (ch === " " || ch === "\t")) {
          record.teclasPaginator += 1;
          if (pageColgada) {

            continue;
          }
          waitingPaginator = false;
          nextPage();
          continue;
        }
        line += ch;
      }
    });

    socket.on("close", () => {
      record.cerrada = true;
      sockets.delete(socket);
    });
    socket.on("error", () => {

      record.cerrada = true;
      sockets.delete(socket);
    });


    programar(() => {
      if (socket.destroyed) return;
      if (escena.banner) write(`${escena.banner}\r\n`);
      if (escena.login) write(`${escena.login.user ?? "Username"}: `);
      else pintarPrompt();
    }, retardoSaludo);
  });

  await new Promise<void>((resolve, reject) => {
    const alError = (error: Error): void => reject(error);
    server.once("error", alError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", alError);
      resolve();
    });
  });

  const cerrar = async (): Promise<void> => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  return {
    port: (server.address() as AddressInfo).port,
    connections,
    cerrar,
  };
}



export async function waitConnections(
  mockConsole: MockConsoleFake,
  n = 1,
  timeoutMs = 5_000,
): Promise<ConnectionMockConsole[]> {
  const limit = Date.now() + timeoutMs;
  while (mockConsole.connections.length < n && Date.now() < limit) {
    await delay(10);
  }
  return mockConsole.connections;
}
