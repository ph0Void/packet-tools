"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useChatContext } from "@/context/ChatContext";
import type {
  AgentProgressEvent,
  ChatAttachment,
  ChatMessageRecord,
  ToolExecution,
} from "@/hooks/useCiscoChat";
import type { DeviceProvider } from "@/service/DeviceProviderService";
import {
  getActiveSessions,
  getConnectionDevices,
  type TerminalActiveSession,
} from "@/service/TerminalSessionService";
import { useChatStore } from "@/store/chatStore";
import { useTerminalStore } from "@/store/terminal.store";
import SidebarChatHistory from "./history/SidebarChatHistory";
import { ChatInputComponent } from "./ChatInputComponent";
import AttachedImagePreviews from "./items/AttachedImagePreviews";
import ToolCardInline, { type ContextoChat } from "./card/ToolCard";
import { ParsedContentComponent } from "./items/ParsedContentComponent";
import { PlanTodos } from "./items/PlanTodos";
import { SkillBadge } from "./items/SkillBadge";
import { SubagentChip } from "./items/SubagentChip";
import { RagSourcesCard } from "./items/RagSourcesCard";
import { AdminActionCard } from "./items/AdminActionCard";
import { TurnoCorteBar } from "./items/TurnoCorteBar";
import {
  esReintentable,
  quitarAvisoCorte,
  type MotivoCorte,
} from "./turnoCorte";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  AlertTriangle,
  Bot,
  Network,
  Sparkles,
  User,
  PanelLeftClose,
  PanelLeftOpen,
  History,
  ArrowRightLeft,
  Loader2,
  PlugZap,
  Zap,
  Lock,
  Check,
  Copy,
  FileText,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const HANDOFF_LABELS: Record<string, string> = {
  general: "Agente General",
  packet_tracer: "Packet Tracer",
  gns3: "GNS3",
  ssh: "SSH",
  telnet: "Telnet",
  serial: "Serial",
};

interface Sugerencia {
  icon: LucideIcon;
  title: string;
  desc: string;
  prompt: string;
}

const SUGGESTIONS: Sugerencia[] = [
  {

    icon: ShieldCheck,
    title: "Configurar OSPF por SSH",
    desc: "Con tu aprobación antes de aplicar",
    prompt:
      "Configura OSPF en el router conectado por SSH (pídeme aprobación antes de aplicar)",
  },
  {

    icon: Network,
    title: "Topología en Packet Tracer",
    desc: "2 routers y 3 switches en estrella",
    prompt:
      "Diseña en Packet Tracer una topología con 2 routers y 3 switches en estrella",
  },
  {

    icon: Search,
    title: "Auditar la topología",
    desc: "Interfaces caídas, vecinos OSPF y rutas",
    prompt:
      "Audita la topología actual: interfaces caídas, vecinos OSPF y rutas faltantes",
  },
  {

    icon: FileText,
    title: "Consultar documentación",
    desc: "Búsqueda RAG sobre tu equipo",
    prompt:
      "Emplea @rag para buscar la documentación interna sobre mi dispositivo conectado por SSH y resume los pasos de configuración",
  },
];

const MORE_IDEAS: { label: string; prompt: string }[] = [
  {
    label: "Laboratorio en GNS3",
    prompt:
      "Levanta en GNS3 un laboratorio con dos routers Cisco conectados por serial",
  },
  {
    label: "Última versión de IOS",
    prompt:
      "Busca en internet con @web la última versión estable de IOS para un Catalyst 2960",
  },
  {
    label: "Tarea diaria de revisión",
    prompt:
      "Programa una tarea diaria a las 8:00 que revise las interfaces caídas",
  },
  {
    label: "Alertas críticas",
    prompt:
      "Muéstrame las alertas CRITICAL y HIGH de las últimas 24 horas",
  },
];

const PROTOCOL_GROUPS = ["SSH", "TELNET", "SERIAL"] as const;

const AGENT_PROGRESS_META: Record<
  AgentProgressEvent["phase"],
  { label: string; icon: LucideIcon; spinner: boolean; tone: string }
> = {
  reading: {
    label: "Leyendo terminal…",
    icon: Loader2,
    spinner: true,
    tone: "border-primary/30 bg-primary/5 text-primary",
  },
  sending: {
    label: "Enviando comando…",
    icon: Loader2,
    spinner: true,
    tone: "border-primary/30 bg-primary/5 text-primary",
  },
  configuring: {
    label: "Configurando equipo…",
    icon: Loader2,
    spinner: true,
    tone: "border-primary/30 bg-primary/5 text-primary",
  },
  verifying: {
    label: "Verificando en el equipo…",
    icon: Loader2,
    spinner: true,
    tone: "border-primary/30 bg-primary/5 text-primary",
  },
  waiting_prompt: {
    label: "Esperando prompt…",
    icon: Loader2,
    spinner: true,
    tone: "border-primary/30 bg-primary/5 text-primary",
  },
  terminal_required: {
    label: "Consola no conectada",
    icon: AlertTriangle,
    spinner: false,
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  connected: {
    label: "Consola conectada",
    icon: PlugZap,
    spinner: false,
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  disconnected: {
    label: "Consola desconectada",
    icon: PlugZap,
    spinner: false,
    tone: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  },
  unknown: {
    label: "Agente trabajando…",
    icon: Loader2,
    spinner: true,
    tone: "border-border/50 bg-muted/40 text-muted-foreground",
  },
};

type ContentSegment =
  | { kind: "text"; text: string }
  | { kind: "tool"; tool: ToolExecution };

const TOOL_FENCE_RE = /```tool\s*\n([\s\S]*?)```/g;
const VALID_TOOL_STATUS: ToolExecution["status"][] = [
  "running",
  "waiting_approval",
  "completed",
  "rejected",
  "error",
];

function parseAssistantContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  TOOL_FENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOOL_FENCE_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        kind: "text",
        text: content.slice(lastIndex, match.index),
      });
    }

    try {
      const parsed = JSON.parse(match[1]) as Partial<ToolExecution>;
      if (typeof parsed.name === "string") {
        segments.push({
          kind: "tool",
          tool: {
            id: parsed.id ?? `tool-${match.index}`,
            name: parsed.name,
            input: (parsed.input ?? {}) as Record<string, unknown>,
            output:
              typeof parsed.output === "string"
                ? parsed.output
                : JSON.stringify(parsed.output ?? ""),
            status:
              parsed.status && VALID_TOOL_STATUS.includes(parsed.status)
                ? parsed.status
                : "completed",
          },
        });
      } else {
        segments.push({ kind: "text", text: match[0] });
      }
    } catch {
      segments.push({ kind: "text", text: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length || segments.length === 0) {
    segments.push({ kind: "text", text: content.slice(lastIndex) });
  }
  return segments;
}

type AprobacionesChat = ContextoChat;

const ToolCardBound = memo(function ToolCardBound({
  tool,
  chat,
}: {
  tool: ToolExecution;
  chat: AprobacionesChat;
}) {
  return <ToolCardInline tool={tool} chat={chat} />;
});

function textoVisibleDelMensaje(message: ChatMessageRecord): string {
  if (message.segments?.length) {
    return message.segments
      .map((segment) =>
        segment.kind === "text"
          ? sinAvisoCorte(segment.text, message.turnoCorte)
          : "",
      )
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return parseAssistantContent(message.content)
    .map((segment) =>
      segment.kind === "text"
        ? sinAvisoCorte(segment.text, message.turnoCorte)
        : "",
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function sinAvisoCorte(texto: string, corte?: MotivoCorte): string {
  return corte ? quitarAvisoCorte(texto) : texto;
}

function textoVisibleDelStream(
  segmentos: ReadonlyArray<{ kind: string; text?: string }>,
  streamingText: string,
): string {
  const deSegmentos = segmentos
    .filter((segment) => segment.kind === "text" && segment.text)
    .map((segment) => segment.text as string)
    .join("\n\n")
    .trim();
  return deSegmentos || streamingText.trim();
}

function formatoHora(fecha: string | Date): string {
  try {
    return new Date(fecha).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function BotonCopiarRespuesta({
  copied,
  onCopy,
}: {
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Respuesta copiada" : "Copiar respuesta"}
      title={copied ? "Respuesta copiada" : "Copiar respuesta"}
      className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground cursor-pointer"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      <span>{copied ? "Copiado" : "Copiar"}</span>
    </button>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center bg-muted",
        role === "user" ? "size-5" : "size-7 mt-0.5",
      )}
    >
      {role === "user" ? (
        <User className="size-3 text-muted-foreground" />
      ) : (
        <Bot size={18} className="text-muted-foreground" />
      )}
    </div>
  );
}

function AttachmentsRow({
  attachments,
  role,
}: {
  attachments?: ChatAttachment[];
  role: "user" | "assistant";
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <AttachedImagePreviews
      attachments={attachments}
      align={role === "user" ? "end" : "start"}
    />
  );
}

function AssistantSegments({
  message,
  copiedId,
  onCopy,
  chat,
}: {
  message: ChatMessageRecord;
  copiedId: string | null;
  onCopy: (msgId: string, text: string) => void;
  chat: AprobacionesChat;
}) {

  const segments = useMemo(() => {
    if (message.segments?.length) return null;
    const parsed = parseAssistantContent(message.content);

    return message.toolCalls?.length
      ? parsed.filter((s) => s.kind !== "tool")
      : parsed;
  }, [message.content, message.toolCalls, message.segments]);

  return (
    <>
      {message.reasoning && (
        <Reasoning
          isStreaming={false}
          defaultOpen={false}
          className="mb-0 w-full"
        >
          <ReasoningTrigger
            className="w-auto text-[12.5px] text-muted-foreground hover:text-foreground"
            getThinkingMessage={() => <span>Razonamiento del modelo</span>}
          />
          <ReasoningContent className="mt-2">
            {message.reasoning}
          </ReasoningContent>
        </Reasoning>
      )}

      {message.segments?.length ? (
        message.segments.map((segment, idx) =>
          segment.kind === "tool" ? (
            segment.tool ? (
              <div
                key={`tool-${segment.tool.id}`}
                className="my-2 max-w-2xl w-full"
              >
                <ToolCardBound tool={segment.tool} chat={chat} />
              </div>
            ) : null
          ) : segment.kind === "plan" ? (

            <PlanTodos
              key={`plan-${message.id}-${idx}`}
              todos={segment.todos}
            />
          ) : sinAvisoCorte(segment.text, message.turnoCorte).trim() ? (
            <ParsedContentComponent
              key={`text-${idx}`}
              text={sinAvisoCorte(segment.text, message.turnoCorte)}
              msgId={`${message.id}-${idx}`}
              onCopy={(text) => onCopy(message.id, text)}
              copied={copiedId === `${message.id}-${idx}`}
            />
          ) : null,
        )
      ) : (
        <>

          {segments?.map((segment, idx) =>
            segment.kind === "text" &&
              sinAvisoCorte(segment.text, message.turnoCorte).trim() ? (
              <ParsedContentComponent
                key={`text-${idx}`}
                text={sinAvisoCorte(segment.text, message.turnoCorte)}
                msgId={`${message.id}-${idx}`}
                onCopy={(text) => onCopy(message.id, text)}
                copied={copiedId === `${message.id}-${idx}`}
              />
            ) : null,
          )}

          {message.toolCalls?.length ? (
            <div className="flex w-full flex-col gap-2">
              {message.toolCalls.map((tool) => (
                <ToolCardBound key={tool.id} tool={tool} chat={chat} />
              ))}
            </div>
          ) : (
            segments?.map((segment) =>
              segment.kind === "tool" ? (
                <div
                  key={`tool-${segment.tool.id}`}
                  className="my-2 max-w-2xl w-full"
                >
                  <ToolCardBound tool={segment.tool} chat={chat} />
                </div>
              ) : null,
            )
          )}
        </>
      )}
    </>
  );
}

export type ChatPrincipalVariant = "page" | "panel";

interface ChatPrincipalWraperProps {

  variant?: ChatPrincipalVariant;
}

export default function ChatPrincipalWraper({
  variant = "page",
}: ChatPrincipalWraperProps) {
  const {
    mounted,
    chats,
    activeChatId,
    activeChat,
    messages,
    isStreaming,
    streamingText,
    streamingChatId,
    toolsInFlight,
    streamSegments,
    reasoningText,
    handoff,
    agentProgress,
    selectedConnectionId,
    setSelectedConnectionId,
    modelProviderId,
    setModelProviderId,
    models,
    defaultModelId,
    sendMessage,
    reintentarTurno,
    approvals,
    resolvingApprovals,
    approveTool,
    rejectTool,
    terminalOpenRequests,
    openTerminalRequest,
    resolveTerminalOpenLocal,
    autonomousMode,
    setAutonomousMode,
    canApprove,

    planTodos,
    skillLoading,
    subagents,
    ragSources,
    adminActions,
  } = useChatContext();

  const activeSessionDevice = useTerminalStore((s) => s.activeSessionDevice);
  const activeSessionProviderId = useTerminalStore(
    (s) => s.activeSessionProviderId,
  );

  const chatModels = useChatStore((s) => s.chatModels);
  const chatConnections = useChatStore((s) => s.chatConnections);

  const modeloVisible =
    activeChatId && chatModels[activeChatId] !== undefined
      ? chatModels[activeChatId]
      : modelProviderId;
  const conexionVisible =
    activeChatId && chatConnections[activeChatId] !== undefined
      ? chatConnections[activeChatId]
      : selectedConnectionId;

  const [devices, setDevices] = useState<DeviceProvider[]>([]);
  const [activeSessions, setActiveSessions] = useState<TerminalActiveSession[]>(
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await getConnectionDevices();
        if (active) {
          setDevices(list);

          if (list.length > 0) {
            useChatStore.getState().pruneChatConnections(list.map((d) => d.id));
          }
        }
      } catch {

      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadSessions = async () => {
      try {
        const sessions = await getActiveSessions();
        if (active) setActiveSessions(sessions);
      } catch {

      }
    };
    void loadSessions();
    const interval = setInterval(() => void loadSessions(), 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeSessionProviderId]);

  useEffect(() => {
    if (!mounted) return;
    const store = useChatStore.getState();
    const activeProviderId =
      useTerminalStore.getState().activeSessionProviderId;
    const porId = activeProviderId
      ? devices.find((d) => d.id === activeProviderId)
      : undefined;
    const porNombre = activeSessionDevice
      ? devices.find((d) => d.name === activeSessionDevice)
      : undefined;
    const consolaActiva = porId ?? porNombre ?? null;
    if (consolaActiva) {
      store.setSelectedConnectionId(consolaActiva.id);
      if (store.activeChatId) {
        store.setChatConnection(store.activeChatId, consolaActiva.id);
      }
      return;
    }

    const chatId = store.activeChatId;

    if (devices.length === 0) return;

    const guardada = chatId ? store.chatConnections[chatId] : undefined;
    if (guardada !== undefined && guardada !== null) {

      if (!devices.some((d) => d.id === guardada)) {
        if (chatId) store.setChatConnection(chatId, null);
        store.setSelectedConnectionId(null);
      }
      return;
    }

    const global = store.selectedConnectionId;
    if (global && !devices.some((d) => d.id === global)) {
      store.setSelectedConnectionId(null);
    }
  }, [
    mounted,
    devices,
    activeChatId,
    activeSessionDevice,
    activeSessionProviderId,
  ]);

  const grouped = useMemo<
    Array<{ protocol: string; items: DeviceProvider[] }>
  >(() => {
    const known = new Set<string>(PROTOCOL_GROUPS);
    const groups: Array<{ protocol: string; items: DeviceProvider[] }> =
      PROTOCOL_GROUPS.map((protocol) => ({
        protocol,
        items: devices.filter(
          (d) => (d.protocol ?? "").toUpperCase() === protocol,
        ),
      })).filter((g) => g.items.length > 0);
    const others = devices.filter(
      (d) => !known.has((d.protocol ?? "").toUpperCase()),
    );
    if (others.length > 0) groups.push({ protocol: "OTROS", items: others });
    return groups;
  }, [devices]);

  const liveProviderIds = useMemo(
    () =>
      new Set(
        activeSessions
          .map((s) => s.providerId)
          .filter((id): id is string => Boolean(id)),
      ),
    [activeSessions],
  );
  const liveDeviceNames = useMemo(
    () =>
      new Set(
        activeSessions
          .map((s) => s.deviceName)
          .filter((name): name is string => Boolean(name)),
      ),
    [activeSessions],
  );

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === conexionVisible) ?? null,
    [devices, conexionVisible],
  );
  const selectedDeviceLive = selectedDevice
    ? liveProviderIds.has(selectedDevice.id) ||
    liveDeviceNames.has(selectedDevice.name)
    : false;

  const aprobaciones = useMemo<AprobacionesChat>(
    () => ({
      approvals,
      resolvingApprovals,
      canApprove,
      approveTool,
      rejectTool,
      terminalOpenRequests,
      openTerminalRequest,
      resolveTerminalOpenLocal,
    }),
    [
      approvals,
      resolvingApprovals,
      canApprove,
      approveTool,
      rejectTool,
      terminalOpenRequests,
      openTerminalRequest,
      resolveTerminalOpenLocal,
    ],
  );

  const defaultName = models.find((m) => m.id === defaultModelId)?.name;

  const modeloEtiqueta = modeloVisible
    ? (models.find((m) => m.id === modeloVisible)?.name ?? "Modelo")
    : (defaultName ?? "Predeterminado");
  const conexionEtiqueta = selectedDevice
    ? `${selectedDeviceLive ? "● " : ""}${selectedDevice.name}`
    : "General";

  const isPanel = variant === "panel";

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showStreaming = isStreaming && streamingChatId === activeChatId;

  const progressMeta = agentProgress
    ? (AGENT_PROGRESS_META[agentProgress.phase] ?? null)
    : null;
  const ProgressIcon = progressMeta?.icon;

  const progressLabel =
    agentProgress?.phase === "unknown" && agentProgress.phaseRaw
      ? `Fase «${agentProgress.phaseRaw}»`
      : progressMeta?.label;

  const handleCopy = useCallback((msgId: string, text: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedId(msgId);
        setTimeout(() => setCopiedId(null), 1500);
      })
      .catch(() => undefined);
  }, []);

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex h-full w-full min-h-0 overflow-hidden bg-background",
          !isPanel && "panel",
        )}
      >

        {!isPanel && (
          <aside
            className={cn(
              "hidden shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-all duration-300 ease-in-out md:flex",
              isCollapsed
                ? "w-0 opacity-0 border-r-0"
                : "w-[236px] opacity-100",
            )}
          >
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">

              <span className="eyebrow">Historial · {chats.length}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    id="btn-collapse-sidebar"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Colapsar historial"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setIsCollapsed(true)}
                  >
                    <PanelLeftClose className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Colapsar historial</TooltipContent>
              </Tooltip>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SidebarChatHistory />
            </div>
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-background/80 px-2 backdrop-blur-md sm:gap-1.5 sm:px-3">
            {!isPanel && isCollapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    id="btn-expand-sidebar"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Mostrar historial"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsCollapsed(false)}
                  >
                    <PanelLeftOpen className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Mostrar historial</TooltipContent>
              </Tooltip>
            )}

            <Button
              id="btn-mobile-history"
              variant="ghost"
              size="icon-sm"
              aria-label="Historial de conversaciones"
              className={cn(
                "shrink-0 text-muted-foreground hover:text-foreground",
                !isPanel && "md:hidden",
              )}
              onClick={() => setMobileHistoryOpen(true)}
            >
              <History className="size-4" />
            </Button>

            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.005em] text-foreground">
              {activeChat?.title ?? "Nueva conversación"}
            </p>

            <span className="spacer hidden flex-1 sm:block" />

            <Tooltip>
              <TooltipTrigger asChild>
                <label
                  className={cn(
                    "flex h-[26px] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-full border px-2 pl-2.5 transition-colors",
                    autonomousMode
                      ? "border-warning/40 bg-warning/10 text-warning"
                      : "border-border bg-transparent text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {autonomousMode ? (
                    <Zap className="size-3 shrink-0" />
                  ) : (
                    <Lock className="size-3 shrink-0" />
                  )}
                  <span className="hidden font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] sm:inline">
                    Modo autónomo
                  </span>
                  <span className="flex items-center">
                    <Switch
                      checked={autonomousMode}
                      onCheckedChange={setAutonomousMode}
                      disabled={!canApprove}
                      aria-label="Modo Autónomo"
                      className="scale-[0.72] origin-center"
                    />
                  </span>
                </label>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {canApprove
                  ? "Si se activa, las acciones de configuración se ejecutan sin pedir aprobación. Solo ADMIN/STAFF."
                  : "Requiere rol STAFF o ADMIN"}
              </TooltipContent>
            </Tooltip>

            <span className="hidden size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10.5px] font-semibold text-muted-foreground sm:flex">
              <User className="size-3.5" />
            </span>
          </header>

          <Conversation className="flex-1 min-h-0 custom-scrollbar">

            <ConversationContent className="mx-auto w-full max-w-[52rem] gap-6 px-4 py-6 sm:px-6">
              {!mounted ? null : messages.length === 0 && !showStreaming ? (
                <ConversationEmptyState className="h-full overflow-y-auto">
                  <div className="flex w-full flex-col items-center gap-3 py-8 text-center">
                    <span className="grid size-11 place-items-center rounded-[10px] border border-info/20 bg-info/10 text-info">
                      <Network className="size-5" />
                    </span>
                    <h1 className="text-[20px] font-semibold text-foreground">
                      Asistente multi-agente de redes
                    </h1>
                    <p className="max-w-[34rem] text-[15px] leading-relaxed text-muted-foreground">
                      Configura, diagnostica y audita tus equipos. Cada cambio
                      de configuración se escribe solo con tu aprobación.
                    </p>
                  </div>
                  <div className="flex w-full max-w-2xl flex-col gap-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {SUGGESTIONS.map(
                        ({ icon: Icon, title, desc, prompt }) => (
                          <button
                            key={title}
                            type="button"
                            onClick={() => void sendMessage(prompt)}
                            className="group flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-card p-3 text-left transition-colors duration-150 hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="mt-0.5 flex shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover:text-primary">
                              <Icon className="size-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[12.5px] font-medium text-foreground">
                                {title}
                              </span>
                              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                                {desc}
                              </span>
                            </span>
                          </button>
                        ),
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                      <span className="eyebrow">
                        Más ideas:
                      </span>
                      {MORE_IDEAS.map(({ label, prompt }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => void sendMessage(prompt)}
                          className="inline-flex h-[26px] cursor-pointer items-center rounded-full border border-border px-2.5 text-[11.5px] text-muted-foreground transition-colors duration-150 hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </ConversationEmptyState>
              ) : (
                <>
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <Message
                        key={m.id}
                        from="user"
                        className="ml-auto items-end"
                      >
                        <div className="flex w-full flex-col items-end gap-1.5">
                          <AttachmentsRow
                            attachments={m.attachments}
                            role="user"
                          />
                          <div className="max-w-[80%] rounded-[14px] rounded-br-[4px] border border-border bg-card px-3.5 py-2.5 text-[14px] leading-[1.6] break-words whitespace-pre-wrap text-foreground">
                            {m.content}
                          </div>
                          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                            <span>{formatoHora(m.createdAt)}</span>
                            <Avatar role="user" />
                          </div>
                        </div>
                      </Message>
                    ) : (
                      <Message
                        key={m.id}
                        from="assistant"
                        className="max-w-full"
                      >
                        <div className="flex items-start gap-3">
                          <Avatar role="assistant" />
                          <div className="min-w-0 flex-1 flex flex-col items-start gap-3">
                            <AttachmentsRow
                              attachments={m.attachments}
                              role="assistant"
                            />
                            <div className="w-full min-w-0 text-[14px] leading-[1.72] text-foreground">
                              <AssistantSegments
                                message={m}
                                copiedId={copiedId}
                                onCopy={handleCopy}
                                chat={aprobaciones}
                              />
                            </div>
                            {textoVisibleDelMensaje(m) && (
                              <div className="flex flex-wrap items-center gap-2">
                                <BotonCopiarRespuesta
                                  copied={copiedId === m.id}
                                  onCopy={() =>
                                    handleCopy(m.id, textoVisibleDelMensaje(m))
                                  }
                                />
                              </div>
                            )}
                            {m.turnoCorte && (
                              <TurnoCorteBar
                                motivo={m.turnoCorte}
                                reintentando={isStreaming}
                                {...(esReintentable(m.turnoCorte)
                                  ? {

                                    onReintentar: () => reintentarTurno(m.id),
                                  }
                                  : {})}
                              />
                            )}
                          </div>
                        </div>
                      </Message>
                    ),
                  )}

                  {showStreaming && (
                    <Message from="assistant" className="max-w-full text-xs">
                      <div className="flex items-start gap-3">
                        <Avatar role="assistant" />
                        <div className="min-w-0 flex-1 flex flex-col items-start gap-3">

                          {handoff && (
                            <Badge
                              variant="outline"
                              className="gap-1.5 border-primary/30 bg-primary/5 text-[10px] font-mono uppercase tracking-wider text-primary animate-pulse"
                            >
                              <ArrowRightLeft className="size-3 shrink-0" />
                              Delegando a{" "}
                              {HANDOFF_LABELS[handoff.to] ?? handoff.to}
                            </Badge>
                          )}

                          {reasoningText && (
                            <Reasoning
                              isStreaming={showStreaming && !streamingText}
                              className="mb-0 w-full"
                            >
                              <ReasoningTrigger
                                className="w-auto text-[12.5px] text-muted-foreground hover:text-foreground"
                                getThinkingMessage={(streaming) =>
                                  streaming ? (
                                    <Shimmer duration={1}>Pensando…</Shimmer>
                                  ) : (
                                    <span>Razonamiento</span>
                                  )
                                }
                              />
                              <ReasoningContent className="mt-2">
                                {reasoningText}
                              </ReasoningContent>
                            </Reasoning>
                          )}

                          <PlanTodos
                            todos={planTodos}
                            className="border-border bg-card"
                          />

                          <SkillBadge skill={skillLoading} />

                          <SubagentChip subagents={subagents} />

                          <RagSourcesCard rag={ragSources} />

                          <AdminActionCard actions={adminActions} />

                          {ProgressIcon && progressMeta && agentProgress && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "gap-1.5 text-[10px] font-mono uppercase tracking-wider",
                                progressMeta.tone,
                              )}
                            >
                              <ProgressIcon
                                className={cn(
                                  "size-3 shrink-0",
                                  progressMeta.spinner && "animate-spin",
                                )}
                              />
                              {progressLabel}
                              {agentProgress.detail
                                ? ` · ${agentProgress.detail}`
                                : ""}
                            </Badge>
                          )}

                          {streamSegments.length > 0 ? (
                            streamSegments.map((segment, idx) =>
                              segment.kind === "tool" ? (
                                <div
                                  key={`seg-tool-${segment.tool.id}`}
                                  className="my-1 w-full max-w-2xl"
                                >
                                  <ToolCardBound
                                    tool={segment.tool}
                                    chat={aprobaciones}
                                  />
                                </div>
                              ) : segment.kind === "plan" ? (

                                <PlanTodos
                                  key={`seg-plan-${idx}`}
                                  todos={segment.todos}
                                  className="border-border bg-card"
                                />
                              ) : segment.text.trim() ? (
                                <div
                                  key={`seg-text-${idx}`}
                                  className="w-full min-w-0 text-[14px] leading-[1.72] text-foreground"
                                >
                                  <div className="prose-cisco relative">
                                    <MessageResponse>
                                      {segment.text}
                                    </MessageResponse>

                                    {idx === streamSegments.length - 1 && (
                                      <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse rounded bg-primary align-middle" />
                                    )}
                                  </div>
                                </div>
                              ) : null,
                            )
                          ) : (

                            <div className="w-full min-w-0 text-[14px] leading-[1.72]">
                              <Shimmer as="span" className="text-sm">
                                {toolsInFlight.some(
                                  (t) => t.status === "running",
                                )
                                  ? "Ejecutando herramientas…"
                                  : "Pensando…"}
                              </Shimmer>
                            </div>
                          )}

                          {textoVisibleDelStream(
                            streamSegments,
                            streamingText,
                          ) && (
                              <BotonCopiarRespuesta
                                copied={copiedId === `stream-${activeChatId}`}
                                onCopy={() =>
                                  handleCopy(
                                    `stream-${activeChatId}`,
                                    textoVisibleDelStream(
                                      streamSegments,
                                      streamingText,
                                    ),
                                  )
                                }
                              />
                            )}
                        </div>
                      </div>
                    </Message>
                  )}
                </>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <footer id="chat-composer" className="shrink-0">
            <ChatInputComponent>

              <Select
                value={modeloVisible ?? "default"}
                onValueChange={(v) =>
                  setModelProviderId(v === "default" ? null : v)
                }
              >
                <SelectTrigger
                  id="select-model"
                  aria-label="Modelo LLM"
                  title={modeloEtiqueta}
                  className="h-8 w-[130px] sm:w-[190px] justify-between gap-1.5 text-[11px] font-mono cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Sparkles className="size-3 text-primary shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    <SelectValue>{modeloEtiqueta}</SelectValue>
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="default"
                    className="font-mono text-xs cursor-pointer"
                  >
                    Predeterminado{defaultName ? ` · ${defaultName}` : ""}
                  </SelectItem>
                  {models.map((m) => (
                    <SelectItem
                      key={m.id}
                      value={m.id}
                      className="font-mono text-xs cursor-pointer"
                    >
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={conexionVisible ?? "none"}
                onValueChange={(v) =>
                  setSelectedConnectionId(v === "none" ? null : v)
                }
              >
                <SelectTrigger
                  id="select-connection"
                  aria-label="Conexión"
                  title={conexionEtiqueta}
                  className="h-8 w-[120px] sm:w-[190px] justify-between gap-1.5 text-[11px] font-mono cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <PlugZap className="size-3 text-muted-foreground shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    <SelectValue>{conexionEtiqueta}</SelectValue>
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="none"
                    className="font-mono text-xs cursor-pointer"
                  >
                    General
                  </SelectItem>
                  {grouped.map((group) => (
                    <SelectGroup key={group.protocol}>
                      <SelectLabel>{group.protocol}</SelectLabel>
                      {group.items.map((device) => (
                        <SelectItem
                          key={device.id}
                          value={device.id}
                          className="font-mono text-xs cursor-pointer"
                        >
                          {liveProviderIds.has(device.id) ||
                            liveDeviceNames.has(device.name)
                            ? "● "
                            : ""}
                          {device.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </ChatInputComponent>
          </footer>
        </main>

        <Dialog open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
          <DialogContent className="p-0 h-[75dvh] max-w-sm w-[calc(100vw-2rem)] overflow-hidden flex flex-col">
            <DialogTitle className="sr-only">
              Historial de conversaciones
            </DialogTitle>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SidebarChatHistory />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
