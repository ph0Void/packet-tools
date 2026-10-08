"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDot,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  ListChecks,
  LogIn,
  Quote,
  Radio,
  Save,
  ShieldAlert,
  SkipForward,
  Terminal as TerminalIcon,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  acotar,
  etiquetaFasePlan,
  etiquetaMotivoAborto,
  etiquetaMotivoCorte,
  ETIQUETA_ESTADO_PASO,
  fueAcotado,
  hostDe,
  quedoEnSubModo,
  rutaLegible,
  situacionConfiguracion,
  type CicloConfiguracion,
  type DiagnosticoConsola,
  type DiagnosticoSinPrompt,
  type DialogoConfig,
  type DispositivoResumen,
  type EstadoPaso,
  type FuenteRag,
  type OmitidaPlanConfig,
  type PasoConfig,
  type ResultadoWeb,
  type SituacionConfiguracion,
  type TonoSituacion,
} from "./toolOutput";
import "./toolCard.css";
import { EstadoConsola } from "./ToolOutputEstate";

export type TonoVisual =
  | "neutro"
  | "activo"
  | "ok"
  | "aviso"
  | "peligro"
  | "error"
  | "info"
  | "mudo";

function Chevron({ abierto }: { abierto: boolean }) {
  return <ChevronDown className="tc-chev" data-open={abierto} />;
}

const LINEAS_CONSOLA_VISIBLES = 3;

export function ConsoleOutput({
  texto,
  error = false,
  className,
}: {
  texto: string;
  error?: boolean;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const lineas = texto.split("\n");
  const plegable = lineas.length > LINEAS_CONSOLA_VISIBLES;
  const ocultas = plegable && !abierto;
  const visible = ocultas ? lineas.slice(0, LINEAS_CONSOLA_VISIBLES) : lineas;

  return (
    <figure
      className={cn("tc-block tc-console", className)}
      data-error={error ? "true" : undefined}
    >
      <div className="tc-block-head">
        <TerminalIcon className="tc-ico" aria-hidden="true" />
        <span className="tc-label">Consola</span>
        {plegable && <span className="tc-count">{lineas.length} líneas</span>}
        {plegable && (
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="tc-toggle"
          >
            {abierto ? "Ver menos" : "Ver salida"}
            <ChevronDown
              className="size-2.5 transition-transform duration-200"
              style={abierto ? { transform: "rotate(180deg)" } : undefined}
            />
          </button>
        )}
      </div>
      <ul className="tc-term-lines custom-scrollbar">
        {visible.map((linea, idx) => (
          <li key={idx} data-tone={tonoLineaConsola(linea, error)}>
            <span className="n">{idx + 1}</span>
            <code>{linea === "" ? " " : linea}</code>
          </li>
        ))}
      </ul>
      {ocultas && (
        <div className="tc-block-body border-t border-border/40">
          <span className="tc-count font-sans">
            +{lineas.length - LINEAS_CONSOLA_VISIBLES} líneas más
          </span>
        </div>
      )}
    </figure>
  );
}

function tonoLineaConsola(linea: string, fallo: boolean): "crit" | "aviso" | undefined {
  if (/invalid input|%.*\^|^\s*\^/i.test(linea)) return "crit";
  if (/administratively down/i.test(linea)) return "aviso";
  if (fallo && /error|denied|failed|no .* salida/i.test(linea)) return "crit";
  return undefined;
}

const RESULTADOS_VISIBLES = 3;

export function WebSearchResults({
  resultados,
  vacio,
}: {
  resultados: ResultadoWeb[];
  vacio: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  if (vacio) {
    return (
      <div className="tc-callout" data-tone="mudo">
        <Quote aria-hidden="true" />
        <span className="tc-text">
          La búsqueda no devolvió resultados. Prueba con otros términos o
          formula la consulta en inglés.
        </span>
      </div>
    );
  }

  const plegable = resultados.length > RESULTADOS_VISIBLES;
  const visibles =
    plegable && !abierto ? resultados.slice(0, RESULTADOS_VISIBLES) : resultados;

  return (
    <div className="grid gap-1.5">
      <ul className="grid gap-1.5">
        {visibles.map((resultado, idx) => {
          const url = resultado.url;
          const href = /^https?:\/\//i.test(url) ? url : undefined;
          const host = url ? hostDe(url) : "";
          return (
            <li key={`${url}-${idx}`}>
              <a
                href={href}
                target={href ? "_blank" : undefined}
                rel={href ? "noreferrer noopener" : undefined}
                className="tc-row group"
              >
                <div className="flex items-start gap-2">
                  <span className="tc-index mt-px">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
                      {resultado.titulo}
                    </p>
                    {url && (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
                        {host}
                        <span className="opacity-60">
                          {rutaLegible(url).replace(host, "")}
                        </span>
                      </p>
                    )}
                    {resultado.descripcion && (
                      <p className="tc-text mt-1 line-clamp-2">
                        {resultado.descripcion}
                      </p>
                    )}
                  </div>
                  {href && (
                    <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
                  )}
                </div>
              </a>
            </li>
          );
        })}
      </ul>

      {plegable && (
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="tc-more"
        >
          {abierto ? "Ver menos" : `Ver ${resultados.length} resultados`}
          <Chevron abierto={abierto} />
        </button>
      )}
    </div>
  );
}

export function RagSources({
  fuentes,
  documentos,
  modo,
}: {
  fuentes: FuenteRag[];
  documentos: string[];
  modo?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const total = Math.max(fuentes.length, documentos.length);
  if (total === 0) return null;

  return (
    <div className={cn("tc-block", abierto && "tc-block-open")}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="tc-block-head"
      >
        <BookMarked className="tc-ico" aria-hidden="true" />
        <span className="text-[11px] font-medium text-foreground">
          {fuentes.length} {fuentes.length === 1 ? "fuente" : "fuentes"}
        </span>
        {documentos.length > 0 && (
          <span className="tc-count">
            {documentos.length} {documentos.length === 1 ? "pasaje" : "pasajes"}
          </span>
        )}
        {modo && <span className="tc-chip">{modo}</span>}
        <Chevron abierto={abierto} />
      </button>

      {abierto && (
        <ul className="tc-block-body grid gap-1.5">
          {fuentes.map((fuente, idx) => (
            <li
              key={`${fuente.titulo}-${idx}`}
              className="flex items-start gap-2 text-[11px]"
            >
              <CircleDot className="mt-0.5 size-2.5 shrink-0 text-primary/50" />
              <span className="min-w-0 flex-1 text-muted-foreground">
                {fuente.titulo}
              </span>
              {typeof fuente.score === "number" && (
                <span className="tc-chip shrink-0 normal-case tracking-normal">
                  {fuente.score.toFixed(2)}
                </span>
              )}
            </li>
          ))}
          {fuentes.length === 0 &&
            documentos.map((doc, idx) => (
              <li key={`doc-${idx}`} className="tc-text line-clamp-3">
                {doc}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

const DISPOSITIVOS_VISIBLES = 6;

export function DeviceList({
  devices,
  className,
}: {
  devices: DispositivoResumen[];
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const plegable = devices.length > DISPOSITIVOS_VISIBLES;
  const visibles =
    plegable && !abierto ? devices.slice(0, DISPOSITIVOS_VISIBLES) : devices;

  return (
    <div className="grid gap-1.5">
      <ul className={cn("grid gap-1.5 sm:grid-cols-2", className)}>
        {visibles.map((device) => {
          const estado = device.status?.toUpperCase() ?? "";
          const activo =
            estado === "ACTIVE" ||
            estado === "CONNECTED" ||
            estado === "ONLINE" ||
            estado === "UP";
          const detalle =
            [device.protocol, device.host ?? device.serialPort]
              .filter(Boolean)
              .join(" · ") || "Sin detalles de conexión";

          return (
            <li
              key={device.id}
              className="tc-row flex items-center gap-2 !py-1.5"
            >
              <span
                className="tc-dot"
                data-tone={activo ? "ok" : "mudo"}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] font-medium text-foreground">
                  {device.name}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {detalle}
                </p>
              </div>
              {device.status && (
                <span
                  className="tc-chip shrink-0"
                  data-tone={activo ? "ok" : "mudo"}
                >
                  {device.status}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {plegable && (
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="tc-more"
        >
          {abierto ? "Ver menos" : `Ver ${devices.length - DISPOSITIVOS_VISIBLES} más`}
          <Chevron abierto={abierto} />
        </button>
      )}
    </div>
  );
}

export function CommandList({
  comandos,
  etiqueta = "Comandos",
}: {
  comandos: string[];
  etiqueta?: string;
}) {
  if (comandos.length === 0) return null;
  return (
    <div className="tc-block">
      <div className="tc-block-head">
        <TerminalIcon className="tc-ico" aria-hidden="true" />
        <span className="tc-label">{etiqueta}</span>
        <span className="tc-count ml-auto">{comandos.length}</span>
      </div>
      <ol className="tc-cmds-lines">
        {comandos.map((comando, idx) => (
          <li key={`${comando}-${idx}`}>
            <span className="n">{idx + 1}</span>
            <code className="min-w-0 flex-1">{comando}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}

const TONO_SITUACION: Record<TonoSituacion, TonoVisual> = {
  ok: "ok",
  aviso: "aviso",
  error: "error",
  info: "info",
  neutro: "mudo",
};

const ICONO_SITUACION: Record<SituacionConfiguracion, LucideIcon> = {
  plan: ListChecks,
  dialogo_pendiente: CircleAlert,
  aplicada_sin_verificar: EyeOff,
  aplicada_verificada: Eye,
  aplicada: CheckCircle2,
  abortada: XCircle,
  sin_escribir: Info,
};

const ESTADO_PASO_META: Record<EstadoPaso, { icon: LucideIcon; tono: TonoVisual }> = {
  enviado: { icon: CheckCircle2, tono: "ok" },
  omitido: { icon: SkipForward, tono: "mudo" },
  dialogo: { icon: CircleAlert, tono: "aviso" },
  error: { icon: XCircle, tono: "error" },
  desconocido: { icon: Info, tono: "mudo" },
};

function Chip({
  children,
  tono,
  className,
}: {
  children: ReactNode;
  tono?: TonoVisual;
  className?: string;
}) {
  return (
    <span className={cn("tc-chip", className)} data-tone={tono}>
      {children}
    </span>
  );
}

function TextoAcotado({
  texto,
  className,
  max,
}: {
  texto: string | null;
  className?: string;
  max?: number;
}) {
  if (!texto || !texto.trim()) return null;
  const recortado = fueAcotado(texto, max);
  return (
    <p className={className}>
      {acotar(texto, max)}
      {recortado && (
        <span className="ml-1 font-sans text-[10px] text-muted-foreground/60">
          (texto íntegro en «Detalles técnicos»)
        </span>
      )}
    </p>
  );
}

function BloquePlegable({
  titulo,
  conteo,
  children,
}: {
  titulo: string;
  conteo?: string;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className={cn("tc-block", abierto && "tc-block-open")}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="tc-block-head"
      >
        <span className="tc-label">{titulo}</span>
        {conteo && <span className="tc-count">{conteo}</span>}
        <Chevron abierto={abierto} />
      </button>
      {abierto && (
        <div className="tc-block-body custom-scrollbar max-h-56 overflow-auto">
          {children}
        </div>
      )}
    </div>
  );
}

function Aviso({
  tono,
  icono: Icono,
  titulo,
  children,
}: {
  tono: TonoVisual;
  icono: LucideIcon;
  titulo: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="tc-callout" data-tone={tono}>
      <Icono aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="tc-callout-title">{titulo}</p>
        {children}
      </div>
    </div>
  );
}

export function AvisoSinPrompt({ sinPrompt }: { sinPrompt: DiagnosticoSinPrompt }) {
  const hayQueAutenticarse = sinPrompt.motivo === "login_pendiente";
  return (
    <Aviso
      tono={hayQueAutenticarse ? "aviso" : "mudo"}
      icono={hayQueAutenticarse ? LogIn : Info}
      titulo={<>La consola no da prompt: {sinPrompt.etiqueta}</>}
    >
      <TextoAcotado
        texto={sinPrompt.consejo}
        className="tc-callout-text"
      />
      {sinPrompt.pendiente && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          En pantalla:{" "}
          <code className="tc-code">{acotar(sinPrompt.pendiente, 120)}</code>
        </p>
      )}
    </Aviso>
  );
}

export function PlanConfiguracion({
  lineas,
  omitidas,
  titulo = "Plan que se aplicaría",
}: {
  lineas: { fase: string; comando: string; motivo: string }[];
  omitidas: OmitidaPlanConfig[];
  titulo?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  if (lineas.length === 0 && omitidas.length === 0) return null;

  return (
    <div className={cn("tc-block", abierto && "tc-block-open")}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="tc-block-head"
      >
        <ListChecks className="tc-ico" aria-hidden="true" />
        <span className="tc-label">{titulo}</span>
        <span className="tc-count">
          {lineas.length} {lineas.length === 1 ? "línea" : "líneas"}
        </span>
        <Chevron abierto={abierto} />
      </button>

      {abierto && (
        <>
          <ol className="divide-y divide-border/30">
            {lineas.map((linea, idx) => (
              <li key={`${linea.comando}-${idx}`} className="px-2.5 py-1.5">
                <div className="flex items-start gap-2">
                  <Chip className="mt-px shrink-0">
                    {etiquetaFasePlan(linea.fase)}
                  </Chip>
                  <code className="tc-code min-w-0 flex-1">{linea.comando}</code>
                </div>
                {linea.motivo && (
                  <p className="tc-text mt-0.5 pl-1 !text-[10px]">
                    {acotar(linea.motivo)}
                  </p>
                )}
              </li>
            ))}
          </ol>

          {omitidas.length > 0 && (
            <div className="border-t border-border/40 px-2.5 py-1.5">
              <p className="tc-label mb-1.5">No se hace ({omitidas.length})</p>
              <ul className="grid gap-1">
                {omitidas.map((omitida, idx) => (
                  <li
                    key={`${omitida.fase}-${idx}`}
                    className="flex items-start gap-1.5"
                  >
                    <SkipForward className="mt-0.5 size-2.5 shrink-0 text-muted-foreground/50" />
                    <div className="min-w-0 flex-1">
                      {omitida.fase && (
                        <Chip className="mr-1 align-middle">
                          {etiquetaFasePlan(omitida.fase)}
                        </Chip>
                      )}
                      <TextoAcotado
                        texto={omitida.porque}
                        className="tc-text inline !text-[10px]"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilaPaso({ paso }: { paso: PasoConfig }) {
  const meta = ESTADO_PASO_META[paso.estado];
  const Icono = meta.icon;
  return (
    <li className="flex items-start gap-2 px-2.5 py-1.5" data-tone={meta.tono}>
      <Icono
        className="mt-0.5 size-3 shrink-0"
        style={{ color: "var(--tc-accent)" }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <Chip className="mt-px shrink-0">{etiquetaFasePlan(paso.fase)}</Chip>
          <code className="tc-code min-w-0 flex-1">{paso.comando}</code>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <span
            className="font-medium"
            style={{ color: "var(--tc-accent)" }}
          >
            {ETIQUETA_ESTADO_PASO[paso.estado]}
          </span>
          {paso.paged && paso.pages > 0 && (
            <span className="tc-count">
              {paso.pages}{" "}
              {paso.pages === 1 ? "página paginada" : "páginas paginadas"}
            </span>
          )}
        </p>
        {paso.detail && (
          <TextoAcotado
            texto={paso.detail}
            className="tc-text mt-0.5 !text-[10px]"
          />
        )}
      </div>
    </li>
  );
}

export function PasosConfiguracion({ pasos }: { pasos: PasoConfig[] }) {
  if (pasos.length === 0) return null;
  return (
    <div className="tc-block">
      <div className="tc-block-head">
        <TerminalIcon className="tc-ico" aria-hidden="true" />
        <span className="tc-label">Lo que se escribió</span>
        <span className="tc-count ml-auto">
          {pasos.length} {pasos.length === 1 ? "paso" : "pasos"}
        </span>
      </div>
      <ol className="divide-y divide-border/30">
        {pasos.map((paso, idx) => (
          <FilaPaso key={`${paso.comando}-${idx}`} paso={paso} />
        ))}
      </ol>
    </div>
  );
}

export function DialogoPendiente({
  dialogo,
  aplicadoAntes,
}: {
  dialogo: DialogoConfig;
  aplicadoAntes: number;
}) {
  return (
    <Aviso tono="aviso" icono={CircleAlert} titulo="Contesta esto en la terminal">
      <pre className="tc-pre-inline custom-scrollbar mt-1.5 max-h-32 !text-[11px] !text-foreground">
        {dialogo.texto}
      </pre>
      <p className="tc-callout-text mt-1.5 !text-[10px]">
        El agente no contesta diálogos por su cuenta: ni preguntas como{" "}
        <code className="font-mono">[y/n]</code> ni confirmaciones destructivas.
        Responde tú en la consola y pídele que reintente.
      </p>
      <p className="tc-callout-text !mt-1 !text-[10px]">
        {aplicadoAntes > 0
          ? `Antes de este diálogo ya se habían escrito ${aplicadoAntes} ${aplicadoAntes === 1 ? "comando" : "comandos"
          }, que no están verificados.`
          : "No se había escrito ningún comando antes del diálogo."}
      </p>
    </Aviso>
  );
}

function BloqueVerificacion({ ciclo }: { ciclo: CicloConfiguracion }) {
  const verificacion = ciclo.verificacion;
  if (!verificacion) {
    if (ciclo.codigo !== "NO_VERIFICADO" && ciclo.escrito) return null;
    return (
      <Aviso tono="aviso" icono={EyeOff} titulo="Sin verificación por lectura">
        <TextoAcotado texto={ciclo.motivoAbortoTexto} className="tc-callout-text" />
        <p className="tc-callout-text !mt-1 !text-[10px]">
          Comprueba tú la configuración en la terminal antes de darla por buena.
        </p>
      </Aviso>
    );
  }

  if (!verificacion.completa) {
    return (
      <Aviso tono="aviso" icono={EyeOff} titulo="No se ha podido verificar">
        <TextoAcotado texto={verificacion.motivo} className="tc-callout-text" />
        <p className="tc-callout-text !mt-1 !text-[10px]">
          Se pidieron estos comandos de lectura y no se pudo leer su salida:{" "}
          {verificacion.pedidos.length > 0
            ? verificacion.pedidos.join(", ")
            : "no constan."}
        </p>
      </Aviso>
    );
  }

  return (
    <div className="tc-block" data-tone="ok">
      <div className="tc-block-head">
        <Eye className="size-3 shrink-0" style={{ color: "var(--tc-accent)" }} />
        <p className="text-[11px] font-semibold text-foreground">
          Verificado leyendo del equipo
          {verificacion.resultados.length > 0 && (
            <span className="ml-1 font-normal text-muted-foreground">
              ({verificacion.resultados.length}{" "}
              {verificacion.resultados.length === 1 ? "comando" : "comandos"}{" "}
              releídos)
            </span>
          )}
        </p>
      </div>
      {verificacion.resultados.length > 0 && (
        <div className="tc-block-body grid gap-1.5">
          {verificacion.resultados.map((resultado, idx) => (
            <div key={`${resultado.comando}-${idx}`}>
              <code className="tc-code">{resultado.comando}</code>
              {resultado.output && (
                <pre className="tc-pre-inline custom-scrollbar mt-0.5 max-h-32">
                  {acotar(resultado.output, 900)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AvisoSubModo({ ciclo }: { ciclo: CicloConfiguracion }) {
  if (!quedoEnSubModo(ciclo)) return null;
  return (
    <Aviso tono="mudo" icono={ShieldAlert} titulo="La consola quedó en un sub-modo">
      <TextoAcotado
        texto={ciclo.avisoSalida ?? ciclo.motivoAbortoTexto}
        className="tc-callout-text"
      />
      {ciclo.promptFinal && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Prompt actual:{" "}
          <code className="tc-code">{acotar(ciclo.promptFinal, 120)}</code>
          {ciclo.modoIndeterminado && (
            <span className="ml-1 text-muted-foreground/70">
              (el prompt no permite distinguir el modo)
            </span>
          )}
        </p>
      )}
      <p className="tc-callout-text !mt-1 !text-[10px]">
        Sal de ese modo en la terminal antes de seguir: desde ahí dentro los
        comandos de lectura fallan sin explicación.
      </p>
    </Aviso>
  );
}

export function ConfiguracionCiclo({ ciclo }: { ciclo: CicloConfiguracion }) {
  const situacion = situacionConfiguracion(ciclo);
  const IconoSituacion = ICONO_SITUACION[situacion.situacion];
  const esPlan = situacion.situacion === "plan";
  const identidad = [
    ciclo.deviceName,
    ciclo.protocolo?.toUpperCase(),
    ciclo.vendorLabel,
  ].filter(Boolean);

  return (
    <div className="grid gap-2">
      <div className="tc-callout" data-tone={TONO_SITUACION[situacion.tono]}>
        <IconoSituacion aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="tc-callout-title">{situacion.titulo}</p>
          <p className="tc-callout-text">{situacion.explicacion}</p>

          {identidad.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
              {identidad.map((dato) => (
                <span key={dato}>{dato}</span>
              ))}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {esPlan ? (
              <Chip tono="info">Simulación · nada escrito</Chip>
            ) : (
              <Chip tono={ciclo.escrito ? "ok" : "mudo"}>
                {ciclo.escrito ? "Comandos escritos" : "Sin comandos escritos"}
              </Chip>
            )}
            {ciclo.guardado && (
              <Chip tono="ok">
                <Save />
                Guardado en memoria
              </Chip>
            )}
            {ciclo.despertar && ciclo.despertar.intentos > 0 && (
              <Chip tono="mudo">
                Consola despertada ({ciclo.despertar.intentos}{" "}
                {ciclo.despertar.intentos === 1 ? "intento" : "intentos"})
              </Chip>
            )}
            {ciclo.motivoAborto && etiquetaMotivoAborto(ciclo.motivoAborto) && (
              <Chip tono="error">
                Parado: {etiquetaMotivoAborto(ciclo.motivoAborto)}
              </Chip>
            )}
          </div>
        </div>
      </div>

      {ciclo.dryRun ? (
        <PlanConfiguracion
          lineas={ciclo.plan.lineas}
          omitidas={ciclo.plan.omitidas}
        />
      ) : (
        <>
          {ciclo.dialogoPendiente && (
            <DialogoPendiente
              dialogo={ciclo.dialogoPendiente}
              aplicadoAntes={
                ciclo.pasos.filter((paso) => paso.estado === "enviado").length
              }
            />
          )}
          <PasosConfiguracion pasos={ciclo.pasos} />
          <BloqueVerificacion ciclo={ciclo} />
          <AvisoSubModo ciclo={ciclo} />
        </>
      )}

      {ciclo.sinPrompt && <AvisoSinPrompt sinPrompt={ciclo.sinPrompt} />}

      {!ciclo.dryRun && ciclo.pasos.some((paso) => paso.output) && (
        <BloquePlegable titulo="Salida del equipo" conteo={`${ciclo.pasos.length}`}>
          <ul className="grid gap-2">
            {ciclo.pasos
              .filter((paso) => paso.output)
              .map((paso, idx) => (
                <li key={`${paso.comando}-${idx}`}>
                  <code className="tc-code !text-[10px]">{paso.comando}</code>
                  <pre className="tc-pre-inline custom-scrollbar mt-0.5 max-h-32">
                    {acotar(paso.output, 1200)}
                  </pre>
                </li>
              ))}
          </ul>
        </BloquePlegable>
      )}
    </div>
  );
}

function etiquetaVendor(vendor: string | null): string {
  if (!vendor) return "—";
  if (vendor.toLowerCase() === "conservative") return "Genérico (sin perfil)";
  return vendor;
}

function CeldaEstado({
  etiqueta,
  children,
  title,
}: {
  etiqueta: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="tc-kv-item" title={title}>
      <span className="tc-label">{etiqueta}</span>
      <div className="tc-kv-value">{children}</div>
    </div>
  );
}

export function EstadoConsolaView({ estado }: { estado: EstadoConsola }) {
  return (
    <div className="grid gap-2">
      <div className="tc-kv">
        <CeldaEstado etiqueta="Sesión">
          <span className="tc-dot" data-tone={estado.viva ? "ok" : "error"} />
          <span>{estado.viva ? "Viva" : "Caída"}</span>
        </CeldaEstado>
        <CeldaEstado etiqueta="Protocolo">
          <Radio className="tc-ico" aria-hidden="true" />
          <span>{estado.protocolo ?? "—"}</span>
        </CeldaEstado>
        <CeldaEstado etiqueta="Prompt">
          <span className="text-primary">{estado.prompt ?? "—"}</span>
        </CeldaEstado>
        <CeldaEstado etiqueta="Equipo">
          <span>{estado.dispositivo ?? "Sin nombre"}</span>
        </CeldaEstado>
        <CeldaEstado etiqueta="Perfil">
          <span>{etiquetaVendor(estado.vendor)}</span>
        </CeldaEstado>
      </div>

      {estado.sinPrompt && <AvisoSinPrompt sinPrompt={estado.sinPrompt} />}

      {!estado.sinPrompt && estado.pendiente && (
        <Aviso tono="aviso" icono={CircleAlert} titulo="Texto pendiente en pantalla">
          <pre className="tc-pre-inline custom-scrollbar mt-1.5 max-h-24 !text-foreground">
            {acotar(estado.pendiente, 240)}
          </pre>
        </Aviso>
      )}

      {estado.lecturas && (
        <BloquePlegable titulo="Comandos de lectura sugeridos">
          <pre className="tc-pre-inline custom-scrollbar max-h-40">
            {estado.lecturas}
          </pre>
        </BloquePlegable>
      )}
    </div>
  );
}

export function ConsolaDiagnostico({ diag }: { diag: DiagnosticoConsola }) {
  const [salida, setSalida] = useState(false);
  const hayDetalles =
    diag.paged || diag.recortado || diag.motivoCorte || diag.despertar;

  return (
    <div className="grid gap-1.5">
      {diag.sinPrompt && <AvisoSinPrompt sinPrompt={diag.sinPrompt} />}

      {diag.codigo === "NO_OUTPUT" && (
        <Aviso
          tono="aviso"
          icono={CircleAlert}
          titulo="El equipo no devolvió ninguna salida"
        >
          <TextoAcotado texto={diag.mensaje} className="tc-callout-text" />
        </Aviso>
      )}

      {diag.codigo === "NO_COMMANDS_EXECUTED" && (
        <Aviso
          tono="error"
          icono={AlertTriangle}
          titulo="No se ejecutó ningún comando"
        >
          <TextoAcotado texto={diag.mensaje} className="tc-callout-text" />
        </Aviso>
      )}

      {hayDetalles && (
        <div className={cn("tc-block", salida && "tc-block-open")}>
          <button
            type="button"
            onClick={() => setSalida((v) => !v)}
            aria-expanded={salida}
            className="tc-block-head"
          >
            <Info className="tc-ico" aria-hidden="true" />
            <span className="tc-label">Cómo llegó la salida</span>
            <Chevron abierto={salida} />
          </button>

          {salida && (
            <ul className="tc-block-body grid gap-1">
              {diag.paged && (
                <li className="tc-text !text-[10px]">
                  El equipo{" "}
                  <span className="text-foreground">
                    paginó su salida
                    {diag.pagerVariant ? ` (${diag.pagerVariant})` : ""}
                  </span>
                  : se pasaron {diag.pages || 1}{" "}
                  {(diag.pages || 1) === 1 ? "página" : "páginas"} para poder
                  leerla entera. Lo que ves es la salida completa.
                </li>
              )}
              {diag.recortado && (
                <li className="tc-text !text-[10px]">
                  La salida se limpió del{" "}
                  <span className="text-foreground">eco del comando</span> (la
                  consola lo repinta carácter a carácter), así que es solo la
                  salida real del equipo.
                </li>
              )}
              {diag.motivoCorte && (
                <li className="tc-text !text-[10px]">
                  No se pudo quitar el eco del comando (motivo:{" "}
                  <span className="text-foreground">
                    {etiquetaMotivoCorte(diag.motivoCorte)}
                  </span>
                  ). Lo que ves puede incluirlo y no es un fallo del equipo.
                </li>
              )}
              {diag.despertar && diag.despertar.intentos > 0 && (
                <li className="tc-text !text-[10px]">
                  La consola no daba prompt y hubo que{" "}
                  <span className="text-foreground">despertarla</span> con{" "}
                  {diag.despertar.intentos}{" "}
                  {diag.despertar.intentos === 1 ? "Return" : "Returns"} antes
                  de enviar nada.
                  {diag.despertar.motivoFinal
                    ? ` Al final, ${acotar(diag.despertar.motivoFinal, 140)}.`
                    : ""}
                </li>
              )}
              {diag.timedOut === true && (
                <li className="tc-text !text-[10px]">
                  Se agotó el plazo esperando el prompt
                  {diag.endReason ? ` (${diag.endReason})` : ""}: lo que hay
                  puede estar incompleto.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
