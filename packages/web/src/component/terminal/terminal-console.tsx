"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  ArrowDownToLine,
  Bold,
  Copy,
  Eraser,
  Minus,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { getSocket } from "@/hooks/useCiscoSocket";
import { confirmTerminalOpen } from "@/service/TerminalSessionService";
import { useTerminalStore } from "@/store/terminal.store";
import { cn } from "@/lib/utils";

export type TerminalRole = "USER" | "STAFF" | "ADMIN";

const SGR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

interface PrefsTerminal {
  fontSize: number;
  bold: boolean;
}

const PREFS_DEFECTO: PrefsTerminal = { fontSize: 14, bold: true };
const FONT_MIN = 10;
const FONT_MAX = 22;
const PREFS_KEY = "terminal-prefs-v1";

function leerPrefs(): PrefsTerminal {
  try {
    const crudo = window.localStorage.getItem(PREFS_KEY);
    if (!crudo) return PREFS_DEFECTO;
    const p = JSON.parse(crudo) as Partial<PrefsTerminal>;
    const size = Number(p.fontSize);
    return {
      fontSize:
        Number.isFinite(size) && size >= FONT_MIN && size <= FONT_MAX
          ? Math.round(size)
          : PREFS_DEFECTO.fontSize,
      bold: typeof p.bold === "boolean" ? p.bold : PREFS_DEFECTO.bold,
    };
  } catch {
    return PREFS_DEFECTO;
  }
}

function guardarPrefs(prefs: PrefsTerminal) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {

  }
}

function opcionesDePrefs(prefs: PrefsTerminal) {
  return {
    fontSize: prefs.fontSize,
    fontWeight: prefs.bold ? ("bold" as const) : ("normal" as const),
    fontWeightBold: "bold" as const,
  };
}

const TEMAS: Record<"light" | "dark", ITheme> = {
  light: {
    background: "#fbfcfd",
    foreground: "#1f2328",
    cursor: "#1d4ed8",
    cursorAccent: "#fbfcfd",
    selectionBackground: "rgba(29, 78, 216, 0.20)",
    selectionInactiveBackground: "rgba(29, 78, 216, 0.10)",
    scrollbarSliderBackground: "rgba(31, 35, 40, 0.20)",
    scrollbarSliderHoverBackground: "rgba(31, 35, 40, 0.35)",
    scrollbarSliderActiveBackground: "rgba(31, 35, 40, 0.50)",

    black: "#1f2328",
    red: "#b91c1c",
    green: "#166534",
    yellow: "#854d0e",
    blue: "#1e40af",
    magenta: "#6b21a8",
    cyan: "#155e75",
    white: "#475569",

    brightBlack: "#57606a",
    brightRed: "#dc2626",
    brightGreen: "#15803d",
    brightYellow: "#a16207",
    brightBlue: "#1d4ed8",
    brightMagenta: "#7e22ce",
    brightCyan: "#0e7490",
    brightWhite: "#64748b",
  },
  dark: {
    background: "#12161e",
    foreground: "#d5dbe6",
    cursor: "#7aa2f7",
    cursorAccent: "#12161e",
    selectionBackground: "rgba(122, 162, 247, 0.30)",
    selectionInactiveBackground: "rgba(122, 162, 247, 0.15)",
    scrollbarSliderBackground: "rgba(213, 219, 230, 0.18)",
    scrollbarSliderHoverBackground: "rgba(213, 219, 230, 0.32)",
    scrollbarSliderActiveBackground: "rgba(213, 219, 230, 0.45)",

    black: "#1b2030",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",

    brightBlack: "#5b6482",
    brightRed: "#ff899d",
    brightGreen: "#9fe044",
    brightYellow: "#faba4a",
    brightBlue: "#8db0ff",
    brightMagenta: "#c7a9ff",
    brightCyan: "#a4daff",
    brightWhite: "#e6eaf5",
  },
};

function leerModo(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function resolverFuente(): string {
  const plex = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-plex-mono")
    .trim();
  return [
    plex,
    '"JetBrains Mono"',
    '"Fira Code"',
    "Consolas",
    "ui-monospace",
    "monospace",
  ]
    .filter(Boolean)
    .join(", ");
}

const MARCO =
  "border-[#d5dbe3] bg-[#fbfcfd] dark:border-[#2a3040] dark:bg-[#12161e]";
const CABECERA =
  "border-[#d5dbe3] bg-[#eef1f5] text-[#57606a] dark:border-[#2a3040] dark:bg-[#1a1f2b] dark:text-[#8b94a8]";
const TEXTO = "text-[#1f2328] dark:text-[#d5dbe6]";
const TEXTO_SUAVE = "text-[#57606a] dark:text-[#8b94a8]";
const SEPARADOR = "bg-[#d5dbe3] dark:bg-[#2a3040]";

const TOKENS: Array<[string, string]> = [

  [
    "sys",
    String.raw`^\*?[A-Z][a-z]{2} +\d+ [\d:.]+: %[^\r\n]*|^%[A-Z0-9_]+-\d-[^\r\n]*`,
  ],

  ["err", String.raw`^[ \t]*%[^\r\n]*`],

  ["cmt", String.raw`^[ \t]*![^\r\n]*`],

  [
    "hdr",
    String.raw`^(?:Interface +IP-Address|Neighbor ID|Device ID|Protocol +Address|Codes:)[^\r\n]*`,
  ],
  ["more", String.raw`--More--`],
  ["ok", String.raw`\[OK\]|\b(?:FULL|connected|established)\b`],
  [
    "warn",
    String.raw`\b(?:INIT|2WAY|EXSTART|EXCHANGE|LOADING|notconnect|err-disabled)\b`,
  ],

  [
    "prompt",
    String.raw`(?<![\w.\-])[A-Za-z][\w.\-]*(?:\([^)\r\n]*\))?[>#]`,
  ],

  [
    "kw",
    String.raw`^[ \t]*(?:no\s+)?(?:interface|router|hostname|line|vlan|ip|ipv6|network|neighbor|access-list|enable|service|banner|spanning-tree|switchport|shutdown|duplex|speed|description|encapsulation|clock|transport|login|password|username|crypto|end|exit)\b`,
  ],
  ["ip", String.raw`\b\d{1,3}(?:\.\d{1,3}){3}\b`],
  ["mac", String.raw`\b[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\b`],
  [
    "iface",
    String.raw`\b(?:FastEthernet|GigabitEthernet|TenGigabitEthernet|Ethernet|Serial|Vlan|Loopback|Tunnel|Port-channel|Fa|Gi|Te|Et|Se|Lo|Vl|Tu|Po)\d+(?:\/\d+)*(?:\.\d+)?\b`,
  ],
  ["down", String.raw`\b(?:administratively down|down|DOWN)\b`],
  ["up", String.raw`\b(?:up|UP)\b`],
  ["yes", String.raw`\bYES\b`],
];

const ESTILO_TOKEN: Record<string, string> = {
  sys: SGR.bold + SGR.yellow,
  err: SGR.bold + SGR.red,
  cmt: SGR.gray,
  hdr: SGR.bold + SGR.blue,
  more: SGR.bold + SGR.yellow,
  ok: SGR.bold + SGR.green,
  warn: SGR.bold + SGR.yellow,
  prompt: SGR.bold + SGR.green,
  kw: SGR.bold + SGR.blue,
  ip: SGR.bold + SGR.cyan,
  mac: SGR.bold + SGR.cyan,
  iface: SGR.bold + SGR.magenta,
  down: SGR.bold + SGR.red,
  up: SGR.bold + SGR.green,
  yes: SGR.bold + SGR.green,
};

const CISCO_TOKENS = new RegExp(
  TOKENS.map(([nombre, patron]) => `(?<${nombre}>${patron})`).join("|"),
  "gm",
);

const TIENE_SGR = /\x1b\[[0-9;]*m/;

function colorizeCiscoOutput(text: string): string {
  if (!text || TIENE_SGR.test(text)) return text;

  return text.replace(CISCO_TOKENS, (...args) => {
    const match = args[0] as string;
    const grupos = args[args.length - 1] as Record<string, string | undefined>;
    for (const nombre in ESTILO_TOKEN) {
      if (grupos[nombre] !== undefined) {
        return `${ESTILO_TOKEN[nombre]}${match}${SGR.reset}`;
      }
    }
    return match;
  });
}

function extractMessage(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string"
  ) {
    return (payload as { message: string }).message;
  }
  return "Error desconocido en la terminal";
}

interface TerminalConsoleProps {
  role: TerminalRole;
  className?: string;
}

export function TerminalConsole({ role, className }: TerminalConsoleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);

  const ajustarRef = useRef<(() => void) | null>(null);
  const pendingEchoRef = useRef("");
  const passwordModeRef = useRef(false);

  const confirmedOpenRef = useRef<string | null>(null);
  const readOnly = role === "USER";
  const status = useTerminalStore((s) => s.status);
  const deviceName = useTerminalStore((s) => s.activeSessionDevice);
  const injections = useTerminalStore((s) => s.pendingInjections);
  const reconnectTick = useTerminalStore((s) => s.reconnectTick);

  const [prefs, setPrefs] = useState<PrefsTerminal>(PREFS_DEFECTO);

  const [hayContenido, setHayContenido] = useState(false);

  useEffect(() => {
    setPrefs(leerPrefs());
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      theme: TEMAS[leerModo()],
      fontFamily: resolverFuente(),
      ...opcionesDePrefs(leerPrefs()),
      lineHeight: 1.3,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      scrollback: 5000,
      disableStdin: readOnly,

      drawBoldTextInBrightColors: true,

      minimumContrastRatio: 4.5,
    });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    try {
      fit.fit();
    } catch {

    }

    const socket = getSocket();
    const store = useTerminalStore;

    const emitResize = () => {
      if (store.getState().status !== "CONNECTED") return;
      socket.emit("terminal:resize", { rows: term.rows, cols: term.cols });
    };

    const ajustar = () => {
      try {
        fit.fit();
      } catch {

      }
      emitResize();
    };
    ajustarRef.current = ajustar;

    const observadorTema = new MutationObserver(() => {
      term.options.theme = TEMAS[leerModo()];
    });
    observadorTema.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    if (!readOnly) {
      term.onData((data) => {
        const { localEcho, status: currentStatus } = store.getState();
        if (
          localEcho &&
          currentStatus === "CONNECTED" &&
          !passwordModeRef.current
        ) {
          for (const ch of Array.from(data)) {
            if (ch === "\r" || ch === "\n") continue;
            if (ch === "\x7f" || ch === "\x08") {
              if (pendingEchoRef.current.length > 0) {
                term.write("\b \b");
                pendingEchoRef.current = pendingEchoRef.current.slice(0, -1);
              }
              continue;
            }
            const codePoint = ch.codePointAt(0) ?? 0;
            if (codePoint >= 0x20 && codePoint !== 0x7f) {
              term.write(ch);
              pendingEchoRef.current = (pendingEchoRef.current + ch).slice(
                -256,
              );
            }
          }
        }
        socket.emit("terminal:data", data);
        if (data.includes("\r")) passwordModeRef.current = false;
      });
    }

    const onTerminalData = (chunk: unknown) => {
      let text = typeof chunk === "string" ? chunk : String(chunk ?? "");

      if (store.getState().localEcho && pendingEchoRef.current.length > 0) {
        let i = 0;
        while (
          i < text.length &&
          i < pendingEchoRef.current.length &&
          text[i] === pendingEchoRef.current[i]
        ) {
          i++;
        }
        if (
          i > 0 &&
          (i === text.length || i === pendingEchoRef.current.length)
        ) {
          pendingEchoRef.current = pendingEchoRef.current.slice(i);
          text = text.slice(i);
        } else {
          pendingEchoRef.current = "";
        }
      }

      if (
        /password\s*:?\s*$/i.test(text) ||
        /contrase(ñ|n)a\s*:?\s*$/i.test(text)
      ) {
        passwordModeRef.current = true;
      }

      setHayContenido(true);
      term.write(colorizeCiscoOutput(text));

      store.getState().appendBuffer(text);
    };

    const confirmarAperturaPendiente = async (
      requestId: string,
      body: { accepted: boolean; sessionId?: string; error?: string },
    ) => {
      if (confirmedOpenRef.current === requestId) return;
      confirmedOpenRef.current = requestId;
      const result = await confirmTerminalOpen(requestId, body);

      const terminal = useTerminalStore.getState();
      if (terminal.pendingOpenRequest?.requestId === requestId) {
        terminal.clearPendingOpenRequest();
      }
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      if (body.accepted) {
        toast.success("Consola abierta por el agente.");
      }
    };

    const onConnected = (payload: unknown) => {
      const type =
        typeof payload === "object" && payload !== null && "type" in payload
          ? String((payload as { type?: unknown }).type ?? "")
          : "";
      const sessionId =
        typeof payload === "object" &&
          payload !== null &&
          "sessionId" in payload &&
          typeof (payload as { sessionId?: unknown }).sessionId === "string"
          ? (payload as { sessionId: string }).sessionId
          : socket.id;
      const providerId =
        typeof payload === "object" &&
          payload !== null &&
          "providerId" in payload &&
          (typeof (payload as { providerId?: unknown }).providerId === "string" ||
            (payload as { providerId?: unknown }).providerId === null)
          ? (payload as { providerId: string | null }).providerId
          : null;

      useTerminalStore.getState().setActiveSessionInfo({
        sessionId,
        protocol: type || null,
        providerId,
      });
      store.getState().setStatus("CONNECTED");
      store.getState().setTerminalBusy(false);
      store.getState().clearInjections();
      pendingEchoRef.current = "";

      setHayContenido(true);
      term.writeln(
        `\r\n${SGR.bold}${SGR.green}●${SGR.reset} ${SGR.bold}Sesión ${type || "remota"} iniciada correctamente${SGR.reset}\r\n`,
      );

      ajustar();

      const pendiente = store.getState().pendingOpenRequest;
      if (pendiente) {
        void confirmarAperturaPendiente(pendiente.requestId, {
          accepted: true,
          sessionId,
        });
      }
    };

    const onError = (payload: unknown) => {
      const message = extractMessage(payload);
      const pendiente = store.getState().pendingOpenRequest;
      if (pendiente) {
        void confirmarAperturaPendiente(pendiente.requestId, {
          accepted: false,
          error: message,
        });
      }
      store.getState().setStatus("DISCONNECTED");
      useTerminalStore.getState().clearActiveSessionInfo();
      store.getState().setTerminalBusy(false);
      pendingEchoRef.current = "";
      setHayContenido(true);
      term.writeln(
        `\r\n${SGR.bold}${SGR.red}[Error]${SGR.reset} ${message}\r\n`,
      );
      toast.error(message);
    };

    const onClosed = () => {
      pendingEchoRef.current = "";
      const pendiente = store.getState().pendingOpenRequest;
      if (pendiente) {
        void confirmarAperturaPendiente(pendiente.requestId, {
          accepted: false,
          error: "La conexión se cerró antes de establecerse.",
        });
      }
      if (store.getState().status === "CONNECTING") return;
      store.getState().setStatus("DISCONNECTED");
      store.getState().setTerminalBusy(false);
      useTerminalStore.getState().clearActiveSessionInfo();
      term.writeln(
        `\r\n${SGR.bold}${SGR.yellow}[Conexión cerrada]${SGR.reset}\r\n`,
      );
    };

    const onTerminalBusy = () =>
      useTerminalStore.getState().setTerminalBusy(true);
    const onTerminalFree = () =>
      useTerminalStore.getState().setTerminalBusy(false);

    socket.on("terminal:data", onTerminalData);
    socket.on("terminal:connected", onConnected);
    socket.on("terminal:error", onError);
    socket.on("terminal:closed", onClosed);
    socket.on("terminal:busy", onTerminalBusy);
    socket.on("terminal:free", onTerminalFree);

    const unsubscribeBusy = useTerminalStore.subscribe((state) => {
      term.options.disableStdin = readOnly || state.terminalBusy;
    });

    const unsubscribeEcho = useTerminalStore.subscribe((state, prev) => {
      if (prev.localEcho && !state.localEcho) pendingEchoRef.current = "";
    });

    const observer = new ResizeObserver(() => ajustar());
    observer.observe(container);

    return () => {
      observer.disconnect();
      observadorTema.disconnect();
      unsubscribeBusy();
      unsubscribeEcho();
      socket.off("terminal:data", onTerminalData);
      socket.off("terminal:connected", onConnected);
      socket.off("terminal:error", onError);
      socket.off("terminal:closed", onClosed);
      socket.off("terminal:busy", onTerminalBusy);
      socket.off("terminal:free", onTerminalFree);
      if (socket.connected) socket.emit("terminal:disconnect");
      useTerminalStore.getState().clearActiveSessionInfo();
      ajustarRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, [readOnly]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || injections.length === 0) return;
    const ahora = Date.now();
    for (const inj of injections) {
      if (ahora - inj.createdAt > 60_000) continue;
      const line = inj.commands.join(" ; ");
      term.write(
        `\r\n${SGR.bold}${SGR.cyan}[Asistente IA]${SGR.reset} ${inj.routed ? "" : "(conexión directa)"
        } ➔ ${SGR.bold}${SGR.yellow}${line}${SGR.reset}\r\n`,
      );
    }
    useTerminalStore.getState().clearInjections();
  }, [injections]);

  useEffect(() => {
    if (reconnectTick <= 0) return;
    const payload = useTerminalStore.getState().lastConnectPayload;
    if (!payload) {
      useTerminalStore.setState({ reconnectTick: 0 });
      return;
    }
    const socket = getSocket();
    if (socket.connected) socket.emit("terminal:disconnect");
    useTerminalStore.getState().setStatus("CONNECTING");
    socket.emit("terminal:connect", payload);
    useTerminalStore.setState({ reconnectTick: 0 });
  }, [reconnectTick]);

  const actualizarPrefs = useCallback((cambio: Partial<PrefsTerminal>) => {
    const siguiente: PrefsTerminal = {
      ...leerPrefs(),
      ...cambio,
    };
    siguiente.fontSize = Math.min(
      FONT_MAX,
      Math.max(FONT_MIN, Math.round(siguiente.fontSize)),
    );
    guardarPrefs(siguiente);
    setPrefs(siguiente);
    const term = termRef.current;
    if (term) {
      const opciones = opcionesDePrefs(siguiente);
      term.options.fontSize = opciones.fontSize;
      term.options.fontWeight = opciones.fontWeight;
      term.options.fontWeightBold = opciones.fontWeightBold;

      requestAnimationFrame(() => ajustarRef.current?.());
    }
  }, []);

  const limpiar = useCallback(() => {
    termRef.current?.clear();
  }, []);

  const copiarSeleccion = useCallback(() => {
    const seleccion = termRef.current?.getSelection() ?? "";
    if (!seleccion) {
      toast.info("Selecciona texto en la consola para copiarlo.");
      return;
    }
    void navigator.clipboard
      .writeText(seleccion)
      .then(() => toast.success("Copiado al portapapeles"))
      .catch(() => toast.error("No se pudo copiar"));
  }, []);

  const irAlFinal = useCallback(() => {
    termRef.current?.scrollToBottom();
  }, []);

  const puntoEstado =
    status === "CONNECTED"
      ? "bg-emerald-500"
      : status === "CONNECTING"
        ? "bg-amber-500 animate-pulse"
        : "bg-zinc-400";
  const textoEstado =
    status === "CONNECTED"
      ? "En línea"
      : status === "CONNECTING"
        ? "Conectando…"
        : "Sin sesión";

  const botonBarra =
    "inline-flex size-6 items-center justify-center rounded-md transition-colors duration-150 hover:bg-black/10 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-primary/15 aria-pressed:text-primary";

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full flex-col overflow-hidden rounded-xl border shadow-sm",
        MARCO,
        className,
      )}
    >

      <div
        className={cn(
          "flex h-9 w-full shrink-0 items-center justify-between gap-3 border-b px-3",
          CABECERA,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", puntoEstado)} />
          <span className={cn("truncate font-mono text-xs font-medium", TEXTO)}>
            {deviceName ?? "Consola"}
          </span>
          <span className="hidden font-mono text-[11px] sm:inline">
            {textoEstado}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">

          <button
            type="button"
            onClick={() => actualizarPrefs({ fontSize: prefs.fontSize - 1 })}
            disabled={prefs.fontSize <= FONT_MIN}
            className={botonBarra}
            aria-label="Reducir tamaño de letra"
            title="Reducir tamaño de letra"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              actualizarPrefs({ fontSize: PREFS_DEFECTO.fontSize })
            }
            className="min-w-9 rounded-md px-1 text-center font-mono text-[11px] tabular-nums transition-colors hover:bg-black/10 dark:hover:bg-white/10"
            aria-label={`Tamaño de letra ${prefs.fontSize} píxeles. Pulsa para restablecer`}
            title="Restablecer tamaño"
          >
            {prefs.fontSize}px
          </button>
          <button
            type="button"
            onClick={() => actualizarPrefs({ fontSize: prefs.fontSize + 1 })}
            disabled={prefs.fontSize >= FONT_MAX}
            className={botonBarra}
            aria-label="Aumentar tamaño de letra"
            title="Aumentar tamaño de letra"
          >
            <Plus className="size-3.5" />
          </button>

          <button
            type="button"
            onClick={() => actualizarPrefs({ bold: !prefs.bold })}
            aria-pressed={prefs.bold}
            className={botonBarra}
            aria-label={prefs.bold ? "Desactivar negrita" : "Activar negrita"}
            title={prefs.bold ? "Negrita: activada" : "Negrita: desactivada"}
          >
            <Bold className="size-3.5" />
          </button>

          <span className={cn("mx-1.5 h-4 w-px", SEPARADOR)} aria-hidden />

          <button
            type="button"
            onClick={copiarSeleccion}
            className={botonBarra}
            aria-label="Copiar selección"
            title="Copiar selección"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={irAlFinal}
            className={botonBarra}
            aria-label="Ir al final"
            title="Ir al final"
          >
            <ArrowDownToLine className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={limpiar}
            className={botonBarra}
            aria-label="Limpiar consola"
            title="Limpiar consola"
          >
            <Eraser className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 w-full flex-1">
        <div ref={containerRef} className="absolute inset-2 md:inset-3" />

        {!hayContenido && status === "DISCONNECTED" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
            <p className={cn("font-mono text-sm font-medium", TEXTO)}>
              Sin sesión activa
            </p>
            <p className={cn("max-w-xs text-xs", TEXTO_SUAVE)}>
              Elige un dispositivo y pulsa Conectar, o usa la conexión manual.
            </p>
          </div>
        )}
      </div>

      {readOnly && status === "CONNECTED" && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md border border-amber-500/40 bg-background/90 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          Modo solo lectura
        </div>
      )}
    </div>
  );
}
