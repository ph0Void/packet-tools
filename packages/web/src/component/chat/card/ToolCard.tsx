"use client";

import { memo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type {
  ApprovalRequest,
  TerminalOpenPayload,
  TerminalOpenRequest,
  ToolExecution,
} from "@/hooks/useCiscoChat";
import { useCaducidadAprobacion } from "@/hooks/useCaducidadAprobacion";
import { toast } from "sonner";
import { useTerminalStore } from "@/store/terminal.store";
import { confirmTerminalOpen } from "@/service/TerminalSessionService";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  Clock,
  LoaderCircle,
  MonitorCog,
  PlugZap,
  Rocket,
  RotateCcw,
  ShieldAlert,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import {
  acotar,
  etiquetaHerramienta,
  explicacionCancelacion,
  limpiarAnsi,
  parseCicloConfiguracion,
  parseDiagnosticoConsola,
  parseDispositivos,
  parseRagOutput,
  parseWebResults,
  resumirError,
  situacionConfiguracion,
  type DispositivoResumen,
  type ErrorAmigable,
} from "./toolOutput";
import {
  CommandList,
  ConfiguracionCiclo,
  ConsoleOutput,
  ConsolaDiagnostico,
  DeviceList,
  EstadoConsolaView,
  RagSources,
  WebSearchResults,
  type TonoVisual,
} from "./toolOutputViews";
import "./toolCard.css";
import { EstadoConsola, parseEstadoConsola } from "./ToolOutputEstate";

const MAX_TEXTO = 1500;

function truncar(texto: string, max = MAX_TEXTO): string {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

export type SalidaParseada =
  | { kind: "web"; resultados: ReturnType<typeof parseWebResults>; vacio: boolean }
  | { kind: "rag"; salida: NonNullable<ReturnType<typeof parseRagOutput>> }
  | {

    kind: "config";
    ciclo: NonNullable<ReturnType<typeof parseCicloConfiguracion>>;
  }
  | {

    kind: "terminal";
    estado: EstadoConsola;
  }
  | {

    kind: "diagnostico";
    diag: NonNullable<ReturnType<typeof parseDiagnosticoConsola>>;
  }
  | { kind: "devices"; devices: DispositivoResumen[] }
  | { kind: "output"; text: string }
  | { kind: "text"; text: string };

const CAMPOS_TEXTO = [
  "output",
  "result",
  "response",
  "message",
  "text",
  "error",
  "summary",
];

function textoDesdeObjeto(objeto: Record<string, unknown>): string | null {
  for (const campo of CAMPOS_TEXTO) {
    const valor = objeto[campo];
    if (typeof valor === "string" && valor.trim()) return valor;
  }
  return null;
}

export function parseSalida(tool: ToolExecution): SalidaParseada | null {
  if (typeof tool.output !== "string" || !tool.output.trim()) return null;
  const bruto = tool.output;

  if (tool.name === "search_web_tool") {
    const resultados = parseWebResults(bruto);
    return { kind: "web", resultados, vacio: resultados.length === 0 };
  }

  let parsed: unknown;
  let esJson = true;
  try {
    parsed = JSON.parse(bruto);
  } catch {
    esJson = false;
  }

  if (esJson) {

    if (tool.name === "search_knowledge_base") {
      const rag = parseRagOutput(bruto);
      if (rag) return { kind: "rag", salida: rag };
    }

    const ciclo = parseCicloConfiguracion(bruto);
    if (ciclo) return { kind: "config", ciclo };

    const estado = parseEstadoConsola(parsed);
    if (estado) return { kind: "terminal", estado };

    const diag = parseDiagnosticoConsola(bruto);
    if (diag) return { kind: "diagnostico", diag };

    const dispositivos = parseDispositivos(bruto);
    if (dispositivos) return { kind: "devices", devices: dispositivos };
  }

  if (!esJson) {
    return { kind: "text", text: truncar(limpiarAnsi(bruto).trim()) };
  }

  if (typeof parsed === "string") {
    const texto = limpiarAnsi(parsed).trim();
    return texto ? { kind: "output", text: truncar(texto) } : null;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const objeto = parsed as Record<string, unknown>;
    const texto = textoDesdeObjeto(objeto);
    if (texto) return { kind: "output", text: truncar(limpiarAnsi(texto).trim()) };

    const mensaje = objeto.message;
    if (typeof mensaje === "string" && mensaje.trim()) {
      return { kind: "text", text: truncar(mensaje.trim()) };
    }
  }

  return {
    kind: "text",
    text: "La herramienta devolvió datos estructurados. Ábrelos en «Detalles técnicos».",
  };
}

export function parseTerminalRequired(
  tool?: ToolExecution,
): { message: string; suggestedProviderId: string | null } | null {
  const salida = tool?.output;
  if (typeof salida !== "string" || !salida.includes("TERMINAL_REQUIRED")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(salida);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const objeto = parsed as Record<string, unknown>;
  if (objeto.code !== "TERMINAL_REQUIRED") return null;

  const sugerido = objeto.suggestedProviderId;
  return {
    message:
      typeof objeto.message === "string" && objeto.message.trim()
        ? objeto.message
        : "No hay una consola de terminal conectada para ejecutar el comando.",
    suggestedProviderId:
      typeof sugerido === "string" && sugerido.trim() ? sugerido : null,
  };
}

export function extraerComandos(tool: ToolExecution): string[] {
  const input = tool.input ?? {};
  const unico = input.command;
  if (typeof unico === "string" && unico.trim()) return [unico.trim()];

  const varios = input.commands;
  if (typeof varios === "string" && varios.trim()) {
    return varios
      .split(/\r?\n/)
      .map((c) => c.trim())
      .filter(Boolean);
  }
  if (Array.isArray(varios)) {
    return varios
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .filter(Boolean);
  }
  return [];
}

export type TonoMarco = TonoVisual;

function subParaPaso(
  salida: SalidaParseada | null,
  comandos: string[],
  dispositivo?: string | null,
): string | null {
  if (comandos.length === 1) return acotar(comandos[0], 80);
  if (comandos.length > 1) {
    return dispositivo
      ? `${comandos.length} comandos en ${dispositivo}`
      : `${comandos.length} comandos`;
  }
  if (!salida) return null;
  switch (salida.kind) {
    case "web":
      return salida.vacio
        ? "sin resultados"
        : `${salida.resultados.length} ${salida.resultados.length === 1 ? "resultado" : "resultados"}`;
    case "rag":
      return `${salida.salida.fuentes.length} ${salida.salida.fuentes.length === 1 ? "fuente" : "fuentes"}`;
    case "devices":
      return `${salida.devices.length} ${salida.devices.length === 1 ? "dispositivo" : "dispositivos"}`;
    case "terminal":
      return `sesión ${salida.estado.viva ? "viva" : "caída"} · ${salida.estado.prompt ?? "sin prompt"}`;
    case "diagnostico":
      return salida.diag.texto
        ? acotar(salida.diag.texto.split("\n")[0] ?? "", 80)
        : (salida.diag.mensaje ?? null);
    case "config":
      return salida.ciclo.deviceName
        ? `equipo ${salida.ciclo.deviceName}`
        : null;
    case "output":
    case "text":
      return acotar(salida.text.split("\n")[0] ?? "", 80) || null;
    default:
      return null;
  }
}

function metaParaPaso(salida: SalidaParseada | null): string | null {
  if (!salida) return null;
  const texto =
    salida.kind === "text" || salida.kind === "output"
      ? salida.text
      : salida.kind === "diagnostico"
        ? (salida.diag.texto ?? null)
        : null;
  if (!texto) return null;
  const lineas = texto.split("\n").length;
  return lineas > 1 ? `${lineas} líneas` : null;
}

type TonoNodo = "ok" | "aviso" | "crit" | "info" | "run" | "mudo";

function Paso({
  nodoTono,
  IconoNodo,
  nombre,
  sub,
  tag,
  tagTono,
  meta,
  extra,
  accionRapida,
  defaultAbierto = true,
  children,
}: {
  nodoTono: TonoNodo;
  IconoNodo: LucideIcon;
  nombre: string;
  sub?: string | null;
  tag?: string | null;
  tagTono?: "aviso" | "crit" | "ok" | "info";
  meta?: string | null;
  extra?: ReactNode;
  accionRapida?: ReactNode;
  defaultAbierto?: boolean;
  children?: ReactNode;
}) {
  const [abierto, setAbierto] = useState(defaultAbierto);
  return (
    <div className="tc-step" data-slot="tool-card">
      <div className="tc-node" data-tone={nodoTono} aria-hidden="true">
        <i>
          <IconoNodo />
        </i>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="tc-head-btn min-w-0 flex-1"
        >
          <span className="tc-name">{nombre}</span>
          {sub && <span className="tc-submono">{sub}</span>}
          <span className="tc-right">
            {extra}
            {tag && (
              <span className="tc-tag" data-tone={tagTono}>
                {tag}
              </span>
            )}
            {meta && <span className="tc-meta">{meta}</span>}
            <ChevronDown
              size={14}
              className={cn(
                "shrink-0 text-muted-foreground/70 transition-transform duration-200",
                abierto && "rotate-180",
              )}
              aria-hidden="true"
            />
          </span>
        </button>
        {accionRapida}
      </div>
      {abierto && <div className="tc-step-body">{children}</div>}
    </div>
  );
}

function LineaSecundaria({ children }: { children: ReactNode }) {
  return <p className="tc-text">{children}</p>;
}

function Callout({
  tono,
  icono: Icono,
  children,
}: {
  tono: TonoMarco;
  icono: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="tc-callout" data-tone={tono}>
      <Icono aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function formatearCrudo(valor: unknown): string {
  if (typeof valor !== "string") return JSON.stringify(valor, null, 2);
  try {
    return JSON.stringify(JSON.parse(valor), null, 2);
  } catch {
    return valor;
  }
}

function DetallesTecnicos({
  tool,
  expanded,
  onToggle,
}: {
  tool: ToolExecution;
  expanded: boolean;
  onToggle: () => void;
}) {
  const tieneEntrada = tool.input && Object.keys(tool.input).length > 0;
  const tieneSalida = typeof tool.output === "string" && tool.output.length > 0;
  if (!tieneEntrada && !tieneSalida) return null;

  return (
    <div className="tc-foot">
      <button
        type="button"
        id={`btn-tool-expand-${tool.id}`}
        onClick={onToggle}
        aria-label="Ver detalles técnicos de la herramienta"
        aria-expanded={expanded}
        className="tc-foot-btn"
      >
        <span className="flex items-center gap-1.5">
          <Terminal size={11} aria-hidden="true" />
          Detalles técnicos
        </span>
        <ChevronDown
          size={12}
          className={cn(
            "transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div className="tc-foot-body">
          {tieneEntrada && (
            <div>
              <p className="tc-label mb-1">Entrada (JSON)</p>
              <pre className="tc-pre-inline custom-scrollbar max-h-48 !text-primary">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}
          {tieneSalida && (
            <div>
              <p className="tc-label mb-1">Salida (JSON)</p>
              <pre
                className={cn(
                  "tc-pre-inline custom-scrollbar max-h-48",
                  tool.status === "error" && "!text-destructive",
                )}
              >
                {formatearCrudo(tool.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SalidaCard({ salida }: { salida: SalidaParseada }) {
  switch (salida.kind) {
    case "web":
      return <WebSearchResults resultados={salida.resultados} vacio={salida.vacio} />;
    case "rag":
      return (
        <RagSources
          fuentes={salida.salida.fuentes}
          documentos={salida.salida.documentos}
          modo={salida.salida.modo}
        />
      );
    case "config":
      return <ConfiguracionCiclo ciclo={salida.ciclo} />;
    case "terminal":
      return <EstadoConsolaView estado={salida.estado} />;
    case "diagnostico":
      return (
        <div className="grid gap-2">

          <ConsolaDiagnostico diag={salida.diag} />
          {salida.diag.texto && <ConsoleOutput texto={salida.diag.texto} />}
        </div>
      );
    case "devices":
      return <DeviceList devices={salida.devices} />;
    case "output":
    case "text":
      return <ConsoleOutput texto={salida.text} />;
    default:
      return null;
  }
}

const SALIDAS_ESTRUCTURADAS: SalidaParseada["kind"][] = [
  "config",
  "diagnostico",
];

function TarjetaConfirmacion({
  tool,
  approval,
  canApprove,
  resolving,
  onApprove,
  onReject,
  expanded,
  onToggle,
}: {
  tool: ToolExecution;
  approval: ApprovalRequest;
  canApprove: boolean;
  resolving: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  const comandos =
    approval.commands.length > 0 ? approval.commands : extraerComandos(tool);

  const peligroso = approval.risk === "dangerous";
  const caducidad = useCaducidadAprobacion(approval.expiresAt);
  const expirada = caducidad?.expirada === true;

  const bloqueado = resolving || !canApprove || expirada;
  const sub =
    comandos.length > 0
      ? `${comandos.length} ${comandos.length === 1 ? "comando" : "comandos"}${approval.deviceName ? ` en ${approval.deviceName}` : ""}`
      : (approval.deviceName ?? null);

  return (
    <Paso
      nodoTono={peligroso ? "crit" : "aviso"}
      IconoNodo={ShieldAlert}
      nombre={etiquetaHerramienta(tool.name)}
      sub={sub}
      extra={
        caducidad ? (
          <span className="tc-chip" data-tone={expirada ? "error" : "mudo"}>
            <Clock aria-hidden="true" />
            {caducidad.texto}
          </span>
        ) : null
      }
    >
      <div
        className="tc-hitl"
        data-tone={peligroso ? "peligro" : "aviso"}
      >
        <div className="tc-hitl-h">
          <ShieldAlert aria-hidden="true" />
          <span
            className="tc-hitl-title"
            data-tone={peligroso ? "peligro" : undefined}
          >
            Requiere tu aprobación antes de escribir
          </span>
          <span className="flex-1" />
          {approval.deviceName && (
            <span className="tc-chip">{approval.deviceName}</span>
          )}
        </div>
        <div className="tc-hitl-b">
          <Callout
            tono={peligroso ? "peligro" : "aviso"}
            icono={peligroso ? ShieldAlert : AlertTriangle}
          >
            <p className="tc-callout-title">
              {peligroso
                ? "Acción destructiva: puede borrar configuración o reiniciar el equipo."
                : "Va a cambiar la configuración del equipo."}
            </p>
            {approval.summary ? (
              <p className="tc-callout-text">{acotar(approval.summary, 200)}</p>
            ) : (
              <p className="tc-callout-text">
                Nada se ha escrito todavía: lo que ves es el plan exacto que se
                enviará si confirmas.
              </p>
            )}
          </Callout>

          <CommandList comandos={comandos} etiqueta="Comandos a ejecutar" />

          {expirada && (
            <Callout tono="error" icono={Clock}>
              <p className="tc-callout-title">
                La solicitud caducó: pídele al agente que la repita para volver a
                autorizarla.
              </p>
            </Callout>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button
              type="button"
              size="xs"
              variant={peligroso ? "destructive" : "default"}
              onClick={onApprove}
              disabled={bloqueado}
              className="cursor-pointer gap-1.5"
            >
              {resolving ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Rocket className="size-3" />
              )}
              Confirmar y ejecutar
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={onReject}
              disabled={resolving || expirada}
              className="cursor-pointer gap-1.5"
            >
              <X className="size-3" />
              Cancelar
            </Button>

            {resolving && (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" />
                Registrando decisión…
              </span>
            )}
            {!canApprove && (
              <span className="tc-note-spec">Requerido para tu rol · STAFF/ADMIN</span>
            )}
          </div>
        </div>
      </div>

      <DetallesTecnicos tool={tool} expanded={expanded} onToggle={onToggle} />
    </Paso>
  );
}

function visualAprobacionResuelta(
  status: ApprovalRequest["status"],
  toolStatus: ToolExecution["status"],
): { nodoTono: TonoNodo; IconoNodo: LucideIcon; tag: string | null; tagTono?: "aviso" | "crit" | "ok" | "info" } {
  if (status === "rejected") return { nodoTono: "mudo", IconoNodo: Ban, tag: null };
  if (status === "expired")
    return { nodoTono: "mudo", IconoNodo: Clock, tag: "Expirada", tagTono: "aviso" };

  if (toolStatus === "completed")
    return { nodoTono: "ok", IconoNodo: Check, tag: null };
  if (toolStatus === "error")
    return { nodoTono: "crit", IconoNodo: XCircle, tag: "Error", tagTono: "crit" };
  if (toolStatus === "rejected")
    return { nodoTono: "mudo", IconoNodo: Ban, tag: null };
  return { nodoTono: "run", IconoNodo: LoaderCircle, tag: null };
}

function TarjetaAprobacionResuelta({
  tool,
  approval,
  salida,
  expanded,
  onToggle,
}: {
  tool: ToolExecution;
  approval: ApprovalRequest;
  salida: SalidaParseada | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visual = visualAprobacionResuelta(
    approval.status,
    tool.status,
  );
  const comandos =
    approval.commands.length > 0 ? approval.commands : extraerComandos(tool);

  return (
    <Paso
      nodoTono={visual.nodoTono}
      IconoNodo={visual.IconoNodo}
      nombre={etiquetaHerramienta(tool.name)}
      sub={subParaPaso(salida, comandos, approval.deviceName)}
      tag={visual.tag}
      tagTono={visual.tagTono}
      meta={metaParaPaso(salida)}
    >
      {comandos.length > 0 && (
        <CommandList
          comandos={comandos}
          etiqueta={
            approval.status === "approved"
              ? "Comandos autorizados"
              : "Comandos propuestos"
          }
        />
      )}

      {salida && SALIDAS_ESTRUCTURADAS.includes(salida.kind) && (
        <SalidaCard salida={salida} />
      )}

      <DetallesTecnicos tool={tool} expanded={expanded} onToggle={onToggle} />
    </Paso>
  );
}

function TarjetaError({
  tool,
  info,
  salida,
  expanded,
  onToggle,
}: {
  tool: ToolExecution;
  info: ErrorAmigable;
  salida: SalidaParseada | null;
  expanded: boolean;
  onToggle: () => void;
}) {

  const reintentarConexion = () => {
    const estado = useTerminalStore.getState();
    if (!estado.lastConnectPayload) {
      toast.info("Selecciona un dispositivo y conéctalo en la terminal");
      return;
    }
    estado.requestReconnect();
    toast.success("Reconectando la terminal…");
  };
  const comandos = extraerComandos(tool);
  const esIncidencia = salida !== null && SALIDAS_ESTRUCTURADAS.includes(salida.kind);

  return (
    <Paso
      nodoTono="crit"
      IconoNodo={XCircle}
      nombre={etiquetaHerramienta(tool.name)}
      sub={subParaPaso(salida, comandos)}
      tag={esIncidencia ? "Incidencia del equipo" : "Error"}
      tagTono="crit"
      meta={metaParaPaso(salida)}
      accionRapida={
        info.reintentable ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={reintentarConexion}
            className="shrink-0 cursor-pointer gap-1.5"
          >
            <RotateCcw className="size-3" />
            Reconectar
          </Button>
        ) : undefined
      }
    >

      <Callout tono="error" icono={AlertTriangle}>
        <p className="tc-callout-title">{info.que}</p>
        {info.accion && <p className="tc-callout-text">{info.accion}</p>}
      </Callout>

      {salida && SALIDAS_ESTRUCTURADAS.includes(salida.kind) && (
        <SalidaCard salida={salida} />
      )}

      <DetallesTecnicos tool={tool} expanded={expanded} onToggle={onToggle} />
    </Paso>
  );
}

function TarjetaTerminalRequerida({
  tool,
  mensaje,
  suggestedProviderId,
  expanded,
  onToggle,
}: {
  tool: ToolExecution;
  mensaje: string;
  suggestedProviderId: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {

  const activeSessionDevice = useTerminalStore((s) => s.activeSessionDevice);
  const router = useRouter();
  const pathname = usePathname();

  const conectar = () => {
    const store = useTerminalStore.getState();
    const deviceId = suggestedProviderId ?? store.deviceProviderId;
    if (deviceId) {
      store.setLastConnectPayload({ providerId: deviceId });
      store.requestReconnect();
      toast.success("Conectando la terminal…");
    } else {
      toast.info(
        "Selecciona un dispositivo en el selector de la terminal y pulsa Conectar",
      );
    }

    if (pathname !== "/dashboard/terminal") {
      router.push("/dashboard/terminal");
    }
  };

  return (
    <Paso
      nodoTono="aviso"
      IconoNodo={PlugZap}
      nombre="Consola no conectada"
      sub={acotar(mensaje, 80) || "la herramienta pidió sesión de terminal y no había ninguna"}
      accionRapida={
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={conectar}
          className="shrink-0 cursor-pointer gap-1.5 border-warning/40 bg-warning/10 text-warning hover:bg-warning/15 hover:text-warning"
        >
          <PlugZap className="size-3" />
          Conectar {activeSessionDevice ?? "dispositivo"}
        </Button>
      }
    >
      <LineaSecundaria>
        {etiquetaHerramienta(tool.name)} pidió una sesión de terminal y no hay
        ninguna conectada.
      </LineaSecundaria>

      <DetallesTecnicos tool={tool} expanded={expanded} onToggle={onToggle} />
    </Paso>
  );
}

export function buscarSolicitudApertura(
  requests: TerminalOpenRequest[],
  toolId: string,
  toolName: string,
): TerminalOpenRequest | null {
  return (
    requests.find((r) => !r.autoOpen && r.toolCallId === toolId) ??
    requests.find(
      (r) => !r.autoOpen && !r.toolCallId && r.toolName === toolName,
    ) ??
    null
  );
}

export function describirDestinoConsola(payload: TerminalOpenPayload): string {
  const protocolo = payload.type ? `${payload.type} · ` : "";
  if (payload.serialPort) {
    return `${protocolo}${payload.serialPort} @ ${payload.baudRate ?? 9600} baudios`;
  }
  if (payload.host) {
    return `${protocolo}${payload.port ? `${payload.host}:${payload.port}` : payload.host}`;
  }
  if (payload.deviceName) {
    return `${protocolo}nodo ${payload.deviceName}`;
  }
  if (payload.providerId) {
    return `${protocolo}dispositivo seleccionado`;
  }
  return protocolo ? protocolo.replace(/ · $/, "") : "consola remota";
}

function TarjetaAperturaConsola({
  tool,
  request,
  chat,
  expanded,
  onToggle,
}: {
  tool: ToolExecution;
  request: TerminalOpenRequest;
  chat: ContextoChat;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [abriendo, setAbriendo] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const ocupado = abriendo || cancelando;

  const abrir = () => {
    setAbriendo(true);
    chat.openTerminalRequest(request);
  };

  const cancelar = async () => {
    setCancelando(true);
    const result = await confirmTerminalOpen(request.requestId, {
      accepted: false,
      error: "Cancelado por el usuario",
    });
    if (!result.success) toast.error(result.message);
    chat.resolveTerminalOpenLocal(request.requestId, false);
    setCancelando(false);
  };

  return (
    <Paso
      nodoTono="info"
      IconoNodo={MonitorCog}
      nombre="El agente pide abrir una consola"
      sub={acotar(describirDestinoConsola(request.payload), 80)}
      extra={
        <span className="tc-chip">
          {request.toolName === "openGns3Console" ? "GNS3" : "Terminal"}
        </span>
      }
    >
      {request.summary && (
        <LineaSecundaria>{acotar(request.summary, 200)}</LineaSecundaria>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button
          type="button"
          size="xs"
          onClick={abrir}
          disabled={ocupado}
          className="cursor-pointer gap-1.5"
        >
          {abriendo ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <PlugZap className="size-3" />
          )}
          Abrir consola
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => void cancelar()}
          disabled={ocupado}
          className="cursor-pointer gap-1.5"
        >
          {cancelando ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <X className="size-3" />
          )}
          Cancelar
        </Button>
        {abriendo && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" />
            Abriendo consola…
          </span>
        )}
      </div>

      <DetallesTecnicos tool={tool} expanded={expanded} onToggle={onToggle} />
    </Paso>
  );
}

function TarjetaRechazada({
  tool,
  texto,
  expanded,
  onToggle,
}: {
  tool: ToolExecution;
  texto: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const motivo =
    texto || "La acción se canceló y no llegó a ejecutarse.";
  return (
    <Paso
      nodoTono="mudo"
      IconoNodo={Ban}
      nombre={etiquetaHerramienta(tool.name)}
      sub={acotar(motivo, 80)}
      defaultAbierto={false}
    >
      <LineaSecundaria>{motivo}</LineaSecundaria>

      <DetallesTecnicos tool={tool} expanded={expanded} onToggle={onToggle} />
    </Paso>
  );
}

const ETIQUETA_COMANDOS: Record<ToolExecution["status"], string> = {
  running: "Comandos en curso",
  waiting_approval: "Comandos propuestos",
  completed: "Comandos ejecutados",
  rejected: "Comandos cancelados",
  error: "Comandos intentados",
};

function visualCompacta(
  status: ToolExecution["status"],
  salida: SalidaParseada | null,
): {
  nodoTono: TonoNodo;
  IconoNodo: LucideIcon;
  tag: string | null;
  tagTono?: "aviso" | "crit" | "ok" | "info";
} {
  if (status === "running")
    return { nodoTono: "run", IconoNodo: LoaderCircle, tag: null };
  if (status === "waiting_approval")
    return { nodoTono: "aviso", IconoNodo: Clock, tag: "Por aprobar", tagTono: "aviso" };
  if (status === "rejected")
    return { nodoTono: "mudo", IconoNodo: Ban, tag: null };
  if (status === "error") {
    const incidencia =
      salida !== null && SALIDAS_ESTRUCTURADAS.includes(salida.kind);
    return {
      nodoTono: "crit",
      IconoNodo: XCircle,
      tag: incidencia ? "Incidencia del equipo" : "Error",
      tagTono: "crit",
    };
  }

  if (salida?.kind === "config") {
    const situacion = situacionConfiguracion(salida.ciclo);
    switch (situacion.situacion) {
      case "plan":
        return { nodoTono: "info", IconoNodo: Terminal, tag: "Simulación", tagTono: "info" };
      case "dialogo_pendiente":
        return { nodoTono: "aviso", IconoNodo: AlertTriangle, tag: "Diálogo pendiente", tagTono: "aviso" };
      case "aplicada_sin_verificar":
        return { nodoTono: "aviso", IconoNodo: AlertTriangle, tag: "Sin verificar", tagTono: "aviso" };
      case "aplicada_verificada":
        return { nodoTono: "ok", IconoNodo: Check, tag: null };
      case "aplicada":
        return { nodoTono: "ok", IconoNodo: Check, tag: "Sin verificar", tagTono: "aviso" };
      case "abortada":
        return { nodoTono: "crit", IconoNodo: XCircle, tag: "Incidencia del equipo", tagTono: "crit" };
      default:
        return { nodoTono: "mudo", IconoNodo: Ban, tag: null };
    }
  }
  if (salida?.kind === "diagnostico") {
    if (salida.diag.codigo === "NO_COMMANDS_EXECUTED")
      return { nodoTono: "crit", IconoNodo: XCircle, tag: "Sin ejecución", tagTono: "crit" };
    if (salida.diag.codigo === "NO_OUTPUT")
      return { nodoTono: "aviso", IconoNodo: AlertTriangle, tag: "Sin salida", tagTono: "aviso" };
    if (salida.diag.sinPrompt)
      return { nodoTono: "aviso", IconoNodo: AlertTriangle, tag: "Sin prompt", tagTono: "aviso" };
    return { nodoTono: "ok", IconoNodo: Check, tag: null };
  }
  if (salida?.kind === "terminal") {
    if (salida.estado.sinPrompt)
      return { nodoTono: "aviso", IconoNodo: AlertTriangle, tag: "Sin prompt", tagTono: "aviso" };
    return {
      nodoTono: salida.estado.viva ? "ok" : "crit",
      IconoNodo: salida.estado.viva ? Check : XCircle,
      tag: null,
    };
  }
  return { nodoTono: "ok", IconoNodo: Check, tag: null };
}

function TarjetaCompacta({
  tool,
  comandos,
  salida,
  expanded,
  onToggle,
}: {
  tool: ToolExecution;
  comandos: string[];
  salida: SalidaParseada | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visual = visualCompacta(tool.status, salida);

  return (
    <Paso
      nodoTono={visual.nodoTono}
      IconoNodo={visual.IconoNodo}
      nombre={etiquetaHerramienta(tool.name)}
      sub={subParaPaso(salida, comandos)}
      tag={visual.tag}
      tagTono={visual.tagTono}
      meta={metaParaPaso(salida)}
      defaultAbierto={tool.status !== "completed"}
    >
      {comandos.length > 0 && (
        <CommandList
          comandos={comandos}
          etiqueta={ETIQUETA_COMANDOS[tool.status] || "Comandos"}
        />
      )}

      {salida && <SalidaCard salida={salida} />}

      {!salida && tool.status === "running" && (
        <LineaSecundaria>Ejecutando la herramienta…</LineaSecundaria>
      )}

      <DetallesTecnicos tool={tool} expanded={expanded} onToggle={onToggle} />
    </Paso>
  );
}

interface AnalisisTool {
  salida: SalidaParseada | null;
  terminalRequerida: ReturnType<typeof parseTerminalRequired>;
  error: ErrorAmigable;
  cancelacion: string;
  comandos: string[];
}

const cacheAnalisis = new WeakMap<ToolExecution, AnalisisTool>();

function analizar(tool: ToolExecution): AnalisisTool {
  const cached = cacheAnalisis.get(tool);
  if (cached) return cached;

  const analisis: AnalisisTool = {
    salida: parseSalida(tool),
    terminalRequerida: parseTerminalRequired(tool),
    error: resumirError(tool.output),
    cancelacion: explicacionCancelacion(tool.output),
    comandos: extraerComandos(tool),
  };
  cacheAnalisis.set(tool, analisis);
  return analisis;
}

export interface ContextoChat {
  approvals: Record<string, ApprovalRequest>;
  resolvingApprovals: Record<string, boolean>;
  canApprove: boolean;
  approveTool: (toolCallId: string) => void | Promise<void>;
  rejectTool: (toolCallId: string) => void | Promise<void>;
  terminalOpenRequests: TerminalOpenRequest[];
  openTerminalRequest: (request: TerminalOpenRequest) => void;
  resolveTerminalOpenLocal: (requestId: string, accepted: boolean) => void;
}

interface ToolCardInlineProps {
  tool: ToolExecution;
  chat: ContextoChat;
}

function ToolCardInline({ tool, chat }: ToolCardInlineProps) {

  const [isExpanded, setIsExpanded] = useState(false);

  const { salida, terminalRequerida, error, cancelacion, comandos } =
    analizar(tool);
  const solicitudApertura = buscarSolicitudApertura(
    chat.terminalOpenRequests,
    tool.id,
    tool.name,
  );
  const approval = chat.approvals[tool.id] ?? null;
  const resolving = chat.resolvingApprovals[tool.id] === true;

  const onToggle = () => setIsExpanded((v) => !v);

  if (approval?.status === "pending") {
    return (
      <TarjetaConfirmacion
        tool={tool}
        approval={approval}
        canApprove={chat.canApprove}
        resolving={resolving}
        onApprove={() => void chat.approveTool(tool.id)}
        onReject={() => void chat.rejectTool(tool.id)}
        expanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  if (approval) {
    return (
      <TarjetaAprobacionResuelta
        tool={tool}
        approval={approval}
        salida={salida}
        expanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  if (
    solicitudApertura &&
    tool.status !== "error" &&
    tool.status !== "rejected"
  ) {
    return (
      <TarjetaAperturaConsola
        tool={tool}
        request={solicitudApertura}
        chat={chat}
        expanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  if (
    terminalRequerida &&
    (tool.status === "error" || tool.status === "completed")
  ) {
    return (
      <TarjetaTerminalRequerida
        tool={tool}
        mensaje={terminalRequerida.message}
        suggestedProviderId={terminalRequerida.suggestedProviderId}
        expanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  if (tool.status === "error") {
    return (
      <TarjetaError
        tool={tool}
        info={error}
        salida={salida}
        expanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  if (tool.status === "rejected") {
    return (
      <TarjetaRechazada
        tool={tool}
        texto={cancelacion}
        expanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }

  return (
    <TarjetaCompacta
      tool={tool}
      comandos={comandos}
      salida={salida}
      expanded={isExpanded}
      onToggle={onToggle}
    />
  );
}

export default memo(ToolCardInline);
