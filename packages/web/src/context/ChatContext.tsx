"use client";

import { getAvailableModelsAction } from "@/action/ConfigAction";
import { updateChatSelectionAction } from "@/action/ChatActions";
import type {
  AdminActionEvent,
  AgentProgressEvent,
  ApprovalRequest,
  ChatAttachment,
  ChatMessageRecord,
  ChatSession,
  HandoffEvent,
  ModelOption,
  PlanTodo,
  RagRetrievedEvent,
  SkillLoadingEvent,
  StreamSegment,
  StreamChatHandlers,
  SubagentEvent,
  TerminalOpenRequest,
  ToolExecution,
} from "@/hooks/useCiscoChat";
import {
  ErrorEnvioRechazado,
  ErrorReintentoNoResoluble,
  normalizeChatMessage,
  normalizeSessionMessages,
  nuevoClientMessageId,
  sendApprovalDecision,
  useAgentChat,
} from "@/hooks/useCiscoChat";
import type { ModelProvider } from "@/service/ConfigService";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useTerminalStore } from "@/store/terminal.store";
import type { LineasTailTerminal } from "@/store/terminal.store";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  anexarAvisoCorte,
  anexarAvisoCorteSegmento,
  conciliarReintento,
  finalDesdeMotivo,
  marcarCorteEnCola,
  mensajeUsuarioReintentable,
  peticionPrecedente,
  resolverParcialTrasRefresco,
  textoDeSegmentos,
  type FinalTurno,
  type MotivoCorte,
} from "@/component/chat/turnoCorte";

const noopSubscribe = () => () => { };

interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data: T | null;

  meta?: MetaPaginacion;
}

export interface MetaPaginacion {
  limit: number | null;
  nextCursor: string | null;
  hasMore: boolean;
  count: number;
}

const CHATS_POR_PAGINA = 30;

export interface TerminalTailPayload {
  lineas: LineasTailTerminal;
  tail: string;
}

type ChatSessionConSeleccion = ChatSession & {
  modelProviderId?: string | null;
  connectionId?: string | null;
};

function seleccionPersistida(raw: unknown): {
  modelProviderId: string | null;
  connectionId: string | null;
} {
  const chat = raw as
    | { modelProviderId?: unknown; connectionId?: unknown }
    | null;
  return {
    modelProviderId:
      typeof chat?.modelProviderId === "string" ? chat.modelProviderId : null,
    connectionId:
      typeof chat?.connectionId === "string" ? chat.connectionId : null,
  };
}

function reconciliarToolsEnVuelo(tools: ToolExecution[]): ToolExecution[] {
  const hayEnVuelo = tools.some(
    (tool) =>
      tool.status === "running" || tool.status === "waiting_approval",
  );
  if (!hayEnVuelo) return tools;
  return tools.map((tool) =>
    tool.status === "running" || tool.status === "waiting_approval"
      ? {
        ...tool,
        status: "error" as const,
        output:
          tool.output ??
          "[TURNO_INTERRUMPIDO] La herramienta no reportó resultado antes de finalizar el turno.",
      }
      : tool,
  );
}

function reconciliarSegmentosEnVuelo(
  segments: StreamSegment[],
): StreamSegment[] {
  const hayEnVuelo = segments.some(
    (segment) =>
      segment.kind === "tool" &&
      (segment.tool.status === "running" ||
        segment.tool.status === "waiting_approval"),
  );
  if (!hayEnVuelo) return segments;
  return segments.map((segment) =>
    segment.kind === "tool"
      ? { ...segment, tool: reconciliarToolsEnVuelo([segment.tool])[0] }
      : segment,
  );
}

export interface ContinuationPending {
  resumen: string;
  pendientes: string[];
}

const LIMITE_RESUMEN_CONTINUACION = 600;

function resumenDeStream(
  segmentos: ReadonlyArray<{ kind: string; text?: string }>,
  streamingText: string,
): string {
  const plano = streamingText.trim();
  if (plano) return plano;
  return textoDeSegmentos(segmentos);
}

function construirMensajeContinuacion(pendiente: ContinuationPending): string {
  const partes: string[] = ["Continua la tarea anterior."];

  const resumen = pendiente.resumen.trim();
  if (resumen) {
    const cortado =
      resumen.length > LIMITE_RESUMEN_CONTINUACION
        ? `${resumen.slice(0, LIMITE_RESUMEN_CONTINUACION)}…`
        : resumen;
    partes.push(`Ya hecho:\n- ${cortado}`);
  }

  const pendientes = pendiente.pendientes
    .map((item) => item.trim())
    .filter(Boolean);
  if (pendientes.length > 0) {
    partes.push(`Pendiente:\n${pendientes.map((item) => `- ${item}`).join("\n")}`);
  }

  return partes.join("\n\n");
}

export interface EnvioMensaje {
  enviado: boolean;
  motivo: "DUPLICADO" | "TURNO_EN_CURSO" | "ERROR" | null;

  messageId?: string;
}

export interface ChatContextValue {
  mounted: boolean;
  loadingChats: boolean;
  chats: ChatSession[];

  hayMasChats: boolean;

  cargarMasChats: () => Promise<void>;
  activeChatId: string | null;
  activeChat: ChatSession | null;
  messages: ChatMessageRecord[];
  isStreaming: boolean;
  streamingText: string;
  streamingChatId: string | null;
  toolsInFlight: ToolExecution[];
  streamSegments: StreamSegment[];
  reasoningText: string;
  handoff: HandoffEvent | null;

  agentProgress: AgentProgressEvent | null;

  selectedConnectionId: string | null;
  setSelectedConnectionId: (id: string | null) => void;
  modelProviderId: string | null;
  setModelProviderId: (id: string | null) => void;
  models: ModelOption[];

  defaultModelId: string | null;

  approvals: Record<string, ApprovalRequest>;

  resolvingApprovals: Record<string, boolean>;
  approveTool: (toolCallId: string) => Promise<void>;
  rejectTool: (toolCallId: string) => Promise<void>;

  terminalOpenRequests: TerminalOpenRequest[];

  planTodos: PlanTodo[];

  skillLoading: SkillLoadingEvent | null;

  subagents: SubagentEvent[];

  ragSources: RagRetrievedEvent | null;

  adminActions: AdminActionEvent[];

  continuationPending: ContinuationPending | null;

  continuarTarea: () => Promise<void>;

  pendingTerminalOpen: TerminalOpenRequest | null;

  openTerminalRequest: (request: TerminalOpenRequest) => void;

  resolveTerminalOpenLocal: (requestId: string, accepted: boolean) => void;

  autonomousMode: boolean;
  setAutonomousMode: (v: boolean) => void;

  canApprove: boolean;
  canDelete: boolean;
  selectChat: (id: string) => void;
  newChat: () => void;
  deleteChat: (id: string) => Promise<void>;
  sendMessage: (
    content: string,
    attachments?: ChatAttachment[],
  ) => Promise<EnvioMensaje>;
  stop: () => void;

  finalTurno: FinalTurno;

  reintentarTurno: (mensajeId: string) => Promise<void>;

  reintentarTras: (mensajeId: string) => Promise<void>;

  setTerminalTail: (fn: (() => TerminalTailPayload | null) | null) => void;

  setTerminalMode: (enabled: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function deriveTitle(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "Nueva conversación";
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

function normalizeAssistantComplete(raw: unknown): ChatMessageRecord | null {
  const rec = normalizeChatMessage(raw);
  if (rec) return rec;

  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as Record<string, unknown>).message === "string"
  ) {
    return {
      id: `local-${Date.now()}`,
      role: "assistant",
      content: (raw as Record<string, string>).message,
      createdAt: new Date().toISOString(),
    };
  }
  return null;
}

function motivoDeError(
  errorTurno: { code?: string } | null,
): MotivoCorte | null {
  if (!errorTurno) return null;

  if (errorTurno.code === "budget_exhausted") return "presupuesto";
  return errorTurno.code === "cancelled" ? "cancelado" : "error";
}

function avisarTurnoEnCurso(): void {
  toast.info(
    "Esta conversación ya tiene un turno en curso. Espera a que termine para continuar.",
  );
}

interface MarcaTurno {

  errorTurno: { code?: string } | null;

  cerradoConComplete: boolean;

  canceladoPorUsuario: boolean;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [loadingChats, setLoadingChats] = useState(true);
  const [models, setModels] = useState<ModelOption[]>([]);

  const [chatsCursor, setChatsCursor] = useState<string | null>(null);

  const [defaultModelIdState, setDefaultModelId] = useState<string | null>(null);
  const [streamingChatId, setStreamingChatId] = useState<string | null>(null);

  const [toolsInFlight, setToolsInFlight] = useState<ToolExecution[]>([]);
  const [streamSegments, setStreamSegments] = useState<StreamSegment[]>([]);
  const [reasoningText, setReasoningText] = useState("");
  const [handoff, setHandoff] = useState<HandoffEvent | null>(null);

  const [agentProgress, setAgentProgress] = useState<AgentProgressEvent | null>(
    null,
  );

  const [approvals, setApprovals] = useState<Record<string, ApprovalRequest>>(
    {},
  );
  const [resolvingApprovals, setResolvingApprovals] = useState<
    Record<string, boolean>
  >({});

  const [terminalOpenRequests, setTerminalOpenRequests] = useState<
    TerminalOpenRequest[]
  >([]);

  const [planTodos, setPlanTodos] = useState<PlanTodo[]>([]);

  const [skillLoading, setSkillLoading] = useState<SkillLoadingEvent | null>(
    null,
  );

  const [subagents, setSubagents] = useState<SubagentEvent[]>([]);

  const [ragSources, setRagSources] = useState<RagRetrievedEvent | null>(null);

  const [adminActions, setAdminActions] = useState<AdminActionEvent[]>([]);

  const [continuationPending, setContinuationPending] =
    useState<ContinuationPending | null>(null);

  const [finalTurno, setFinalTurno] = useState<FinalTurno>("completo");

  const corteColaRef = useRef<{ chatId: string; motivo: MotivoCorte } | null>(
    null,
  );

  const parcialLocalRef = useRef<ChatMessageRecord | null>(null);

  const toolsInFlightRef = useRef<ToolExecution[]>([]);
  const streamSegmentsRef = useRef<StreamSegment[]>([]);
  const reasoningTextRef = useRef("");

  const planTodosRef = useRef<PlanTodo[]>([]);

  useEffect(() => {
    toolsInFlightRef.current = toolsInFlight;
  }, [toolsInFlight]);

  useEffect(() => {
    streamSegmentsRef.current = streamSegments;
  }, [streamSegments]);

  useEffect(() => {
    reasoningTextRef.current = reasoningText;
  }, [reasoningText]);

  const { send, stop } = useAgentChat();

  const terminalTailRef = useRef<(() => TerminalTailPayload | null) | null>(null);
  const setTerminalTail = useCallback(
    (fn: (() => TerminalTailPayload | null) | null) => {
      terminalTailRef.current = fn;
    },
    [],
  );

  const terminalModeRef = useRef<boolean>(false);
  const setTerminalMode = useCallback((enabled: boolean) => {
    terminalModeRef.current = enabled;
  }, []);

  const router = useRouter();

  const abrirConsola = useCallback(
    (request: TerminalOpenRequest) => {
      const payload = { ...request.payload };
      const terminal = useTerminalStore.getState();
      terminal.setPendingOpenRequest({
        requestId: request.requestId,
        payload,
      });
      terminal.setLastConnectPayload(payload);
      terminal.requestReconnect();
      router.push("/dashboard/terminal");
    },
    [router],
  );

  const resolveTerminalOpenLocal = useCallback(
    (requestId: string, accepted: boolean) => {
      setTerminalOpenRequests((prev) =>
        prev.filter((r) => r.requestId !== requestId),
      );
      const terminal = useTerminalStore.getState();
      if (!accepted && terminal.pendingOpenRequest?.requestId === requestId) {
        terminal.clearPendingOpenRequest();
      }
    },
    [],
  );

  const chats = useChatStore((s) => s.chats);
  const activeChatId = useChatStore((s) => s.activeChatId);
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingText = useChatStore((s) => s.streamingText);
  const selectedConnectionId = useChatStore((s) => s.selectedConnectionId);
  const modelProviderId = useChatStore((s) => s.modelProviderId);
  const autonomousMode = useChatStore((s) => s.autonomousMode);
  const setAutonomousMode = useChatStore((s) => s.setAutonomousMode);

  const seleccionarModelo = useCallback((id: string | null) => {
    const store = useChatStore.getState();
    store.setModelProviderId(id);
    const chatId = store.activeChatId;
    if (chatId) {
      store.setChatModel(chatId, id);

      void updateChatSelectionAction(chatId, {
        modelProviderId: id,
      }).catch(() => undefined);
    }
  }, []);

  const seleccionarConexion = useCallback((id: string | null) => {
    const store = useChatStore.getState();
    store.setSelectedConnectionId(id);
    const chatId = store.activeChatId;
    if (chatId) {
      store.setChatConnection(chatId, id);
      void updateChatSelectionAction(chatId, {
        connectionId: id,
      }).catch(() => undefined);
    }
  }, []);

  const user = useAuthStore((s) => s.user);
  const canDelete = user?.role === "ADMIN" || user?.role === "STAFF";
  const canApprove = user?.role === "ADMIN" || user?.role === "STAFF";

  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const cargarHistorial = useCallback(async (chatId: string) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<unknown[]>;
      if (!Array.isArray(json.data)) return;
      const store = useChatStore.getState();

      if (store.activeChatId !== chatId) return;
      let mensajes = normalizeSessionMessages(json.data);
      const corte = corteColaRef.current;
      if (corte && corte.chatId === chatId) {
        mensajes = resolverParcialTrasRefresco(
          mensajes,
          parcialLocalRef.current,
          corte.motivo,
        );
      }
      store.setMessages(mensajes);
      const chat = store.chats.find((c) => c.id === chatId);
      if (chat) store.upsertChat({ ...chat, messages: mensajes });
    } catch {

    }
  }, []);

  const applyChats = useCallback(
    (
      list: ChatSessionConSeleccion[],
      {
        append = false,
        completo = true,
      }: { append?: boolean; completo?: boolean } = {},
    ) => {
      const store = useChatStore.getState();

      const previos = new Map(store.chats.map((chat) => [chat.id, chat]));
      const normalizados = list.map((chat) => {
        const previo = previos.get(chat.id);
        const traeMensajes = Array.isArray(chat.messages);
        let messages = normalizeSessionMessages(chat.messages);
        if (!traeMensajes && previo && previo.messages.length > 0) {
          messages = previo.messages;
        }

        const corte = corteColaRef.current;
        if (corte && corte.chatId === chat.id) {
          messages = resolverParcialTrasRefresco(
            messages,
            parcialLocalRef.current,
            corte.motivo,
          );
        }
        return {
          ...chat,
          messageCount: typeof chat.messageCount === "number" ? chat.messageCount : messages.length,
          attachmentCount:
            typeof chat.attachmentCount === "number" ? chat.attachmentCount : 0,
          messages,
        };
      });

      const fusionados = append
        ? [
          ...normalizados,
          ...store.chats.filter(
            (previo) => !normalizados.some((chat) => chat.id === previo.id),
          ),
        ]
        : normalizados;
      store.setChats(fusionados);

      for (const chat of fusionados) {
        store.hidratarSeleccionChat(chat.id, seleccionPersistida(chat));
      }

      const current = store.activeChatId;
      if (current && fusionados.some((c) => c.id === current)) {

        store.restaurarSeleccionChat(current);

        const chat = list.find((c) => c.id === current);
        if (chat && Array.isArray(chat.messages)) {
          const activo = fusionados.find((c) => c.id === current);
          store.setMessages(activo ? [...activo.messages] : []);
        }
      } else if (append) {

      } else if (!completo) {

        if (current) store.restaurarSeleccionChat(current);
      } else {
        store.setActiveChatId(null);
        store.setMessages([]);
      }
    },
    [],
  );

  const refreshChats = useCallback(
    async (withSpinner = false) => {
      if (withSpinner) setLoadingChats(true);
      try {
        const res = await fetch(`/api/chats?limit=${CHATS_POR_PAGINA}`, {
          credentials: "include",
          cache: "no-store",
        });
        const json = (await res.json()) as ApiEnvelope<
          ChatSessionConSeleccion[]
        >;
        if (Array.isArray(json.data)) {
          applyChats(json.data, {

            completo: !(json.meta?.hasMore ?? false),
          });
          setChatsCursor(json.meta?.nextCursor ?? null);
        }
      } catch {
      } finally {
        if (withSpinner) setLoadingChats(false);
      }
      const activo = useChatStore.getState().activeChatId;
      if (activo) await cargarHistorial(activo);
    },
    [applyChats, cargarHistorial],
  );

  const cargarMasChats = useCallback(async () => {
    const cursor = chatsCursor;
    if (!cursor) return;
    try {
      const res = await fetch(
        `/api/chats?limit=${CHATS_POR_PAGINA}&cursor=${encodeURIComponent(cursor)}`,
        { credentials: "include", cache: "no-store" },
      );
      const json = (await res.json()) as ApiEnvelope<
        ChatSessionConSeleccion[]
      >;
      if (!Array.isArray(json.data)) return;
      applyChats(json.data, { append: true, completo: false });
      setChatsCursor(json.meta?.nextCursor ?? null);
    } catch {

    }
  }, [applyChats, chatsCursor]);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await refreshChats(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted, refreshChats]);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;

    getAvailableModelsAction()
      .then((result) => {
        if (cancelled) return;
        const list = (
          Array.isArray(result.data) ? result.data : []
        ) as ModelProvider[];
        const mapped = list
          .filter((m) => m.isActive && m.typeModel === "CHAT")
          .map((m) => ({
            id: m.id,
            name: m.name,
            provider: m.provider,
            modelName: m.modelName,
          }));
        setModels(mapped);

        if (result.success && mapped.length > 0) {
          setDefaultModelId(mapped[0].id);
          const idsValidos = mapped.map((m) => m.id);
          useChatStore.getState().pruneChatModels(idsValidos);

          const store = useChatStore.getState();
          const chatId = store.activeChatId;
          const modeloChat = chatId ? store.chatModels[chatId] : undefined;
          const modeloEfectivo =
            modeloChat !== undefined ? modeloChat : store.modelProviderId;

          if (modeloEfectivo && !idsValidos.includes(modeloEfectivo)) {

            store.setModelProviderId(null);
            if (chatId) store.setChatModel(chatId, null);
          } else if (
            chatId &&
            typeof modeloChat === "string" &&
            modeloChat !== store.modelProviderId
          ) {

            store.setModelProviderId(modeloChat);
          }
        } else if (result.success) {

          setDefaultModelId(null);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [mounted]);

  const selectChat = useCallback(
    (id: string) => {
      const store = useChatStore.getState();
      store.setActiveChatId(id);

      store.restaurarSeleccionChat(id);

      setContinuationPending(null);

      const corte = corteColaRef.current;
      if (corte && corte.chatId === id) {

        const mensajes = useChatStore.getState().messages;
        store.setMessages(
          resolverParcialTrasRefresco(
            mensajes,
            parcialLocalRef.current,
            corte.motivo,
          ),
        );
      }

      void cargarHistorial(id);
    },
    [cargarHistorial],
  );

  const newChat = useCallback(() => {
    const store = useChatStore.getState();
    store.setActiveChatId(null);
    store.setMessages([]);
    store.clearStreamingText();
    setToolsInFlight([]);
    setStreamSegments([]);
    setReasoningText("");
    setHandoff(null);
    setApprovals({});
    setResolvingApprovals({});
    setTerminalOpenRequests([]);
    setContinuationPending(null);
    planTodosRef.current = [];
  }, []);

  const deleteChat = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/chats/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as
            | ApiEnvelope<null>
            | null;
          throw new Error(json?.message || "Error al eliminar la conversación");
        }

        const store = useChatStore.getState();
        const wasActive = store.activeChatId === id;
        const nextId =
          store.chats.find((c) => c.id !== id)?.id ?? null;

        store.removeChat(id);

        if (wasActive) {
          if (nextId) {
            store.setActiveChatId(nextId);
            store.restaurarSeleccionChat(nextId);
            void cargarHistorial(nextId);
          } else {
            store.setActiveChatId(null);
            store.setMessages([]);
          }
        }
        toast.success("Conversación eliminada");
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Error al eliminar",
        );
      }
    },
    [cargarHistorial],
  );

  const ensureChat = useCallback(
    async (firstContent: string): Promise<string | null> => {
      const storeActual = useChatStore.getState();
      const existing = storeActual.activeChatId;
      if (existing) return existing;

      const modeloHeredado = storeActual.modelProviderId;
      const conexionHeredada = storeActual.selectedConnectionId;

      try {
        const res = await fetch("/api/chats", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: deriveTitle(firstContent),
            modelProviderId: modeloHeredado,
            connectionId: conexionHeredada,
          }),
        });
        const json = (await res.json()) as ApiEnvelope<ChatSessionConSeleccion>;
        if (!res.ok || !json.success || !json.data) {
          toast.error(json.message || "No se pudo crear la conversación");
          return null;
        }
        const created: ChatSessionConSeleccion = {
          ...json.data,
          messages: normalizeSessionMessages(json.data.messages ?? []),
        };
        const store = useChatStore.getState();
        store.upsertChat(created);
        store.setActiveChatId(created.id);
        store.aplicarSeleccionChat(created.id, {
          modelProviderId: modeloHeredado,
          connectionId: conexionHeredada,
        });
        return created.id;
      } catch {
        toast.error("No se pudo crear la conversación");
        return null;
      }
    },
    [],
  );

  const resolveToolApproval = useCallback(
    async (toolCallId: string, decision: "approve" | "reject") => {
      const entry = approvals[toolCallId];
      if (
        !entry ||
        entry.status !== "pending" ||
        resolvingApprovals[toolCallId]
      ) {
        return;
      }

      setResolvingApprovals((prev) => ({ ...prev, [toolCallId]: true }));
      try {
        const result = await sendApprovalDecision(entry.approvalId, decision);
        if (!result.success) {
          toast.error(result.message);
          return;
        }
        setApprovals((prev) => {
          const current = prev[toolCallId];
          if (!current) return prev;

          return {
            ...prev,
            [toolCallId]: {
              ...current,
              status:
                result.decision ??
                (decision === "approve" ? "approved" : "rejected"),
            },
          };
        });
      } finally {

        setResolvingApprovals((prev) => {
          if (!(toolCallId in prev)) return prev;
          const next = { ...prev };
          delete next[toolCallId];
          return next;
        });
      }
    },
    [approvals, resolvingApprovals],
  );

  const approveTool = useCallback(
    (toolCallId: string) => resolveToolApproval(toolCallId, "approve"),
    [resolveToolApproval],
  );

  const rejectTool = useCallback(
    (toolCallId: string) => resolveToolApproval(toolCallId, "reject"),
    [resolveToolApproval],
  );

  const construirRespuestaParcial = useCallback(
    (store: ReturnType<typeof useChatStore.getState>, motivo: MotivoCorte) => {
      const texto = store.streamingText;
      const segmentos = reconciliarSegmentosEnVuelo(streamSegmentsRef.current);
      const contenido = texto.trim() || textoDeSegmentos(segmentos);
      if (!contenido.trim() && segmentos.length === 0) return null;
      const copia = segmentos.map((segmento) => ({ ...segmento }));
      if (contenido.trim()) anexarAvisoCorteSegmento(copia, motivo);
      return {
        id: `local-parcial-${Date.now()}`,
        role: "assistant" as const,
        content: texto.trim() ? anexarAvisoCorte(texto, motivo) : "",
        createdAt: new Date().toISOString(),
        ...(copia.length > 0 ? { segments: copia } : {}),
        turnoCorte: motivo,
      };
    },
    [],
  );

  const abrirTurno = useCallback((chatId: string) => {
    const store = useChatStore.getState();
    store.setStreaming(true);
    store.clearStreamingText();
    setStreamingChatId(chatId);
    corteColaRef.current = null;
    parcialLocalRef.current = null;
    setFinalTurno("completo");
    setToolsInFlight([]);
    setStreamSegments([]);
    setReasoningText("");
    setHandoff(null);
    setApprovals({});
    setResolvingApprovals({});
    setAgentProgress(null);
    setTerminalOpenRequests([]);
    setPlanTodos([]);
    planTodosRef.current = [];
    setSkillLoading(null);
    setSubagents([]);
    setRagSources(null);
    setAdminActions([]);

    setContinuationPending(null);
  }, []);

  const handlersDeTurno = useCallback(
    (chatId: string, marca: MarcaTurno): StreamChatHandlers => ({
      onUserMessage: (m) => {
        const rec = normalizeChatMessage(m);
        if (!rec) return;
        const s = useChatStore.getState();
        if (s.activeChatId === chatId) s.addMessage(rec);
      },
      onToken: (t) => {
        useChatStore.getState().appendStreamingText(t);

        setStreamSegments((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "text") {

            const updated = [...prev];
            updated[updated.length - 1] = { kind: "text", text: last.text + t };
            return updated;
          }

          return [...prev, { kind: "text", text: t }];
        });
      },
      onToolStart: (t) => {
        const toolExec: ToolExecution = { ...t, status: "running" };
        setToolsInFlight((prev) =>
          prev.some((p) => p.id === t.id)
            ? prev.map((p) =>
              p.id === t.id
                ? {
                  ...p,
                  ...t,

                  status:
                    p.status === "waiting_approval"
                      ? "waiting_approval"
                      : "running",
                  ...(p.approvalId ? { approvalId: p.approvalId } : {}),
                }
                : p,
            )
            : [...prev, toolExec],
        );

        setStreamSegments((prev) => {
          if (prev.some((s) => s.kind === "tool" && s.tool.id === t.id)) return prev;
          return [...prev, { kind: "tool", tool: toolExec }];
        });
      },
      onToolEnd: (t) => {
        const updateTool = (prev: ToolExecution[]) => {
          if (prev.some((p) => p.id === t.id)) {
            return prev.map((p) =>
              p.id === t.id
                ? {
                  ...p,
                  name: p.name || t.name,
                  input: t.input ?? {},
                  output: t.output,
                  status: t.status,
                }
                : p,
            );
          }

          return [
            ...prev,
            {
              id: t.id,
              name: t.name,
              input: t.input ?? {},
              output: t.output,
              status: t.status,
            },
          ];
        };
        setToolsInFlight(updateTool);

        setStreamSegments((prev) => {
          const idx = prev.findIndex(
            (s) => s.kind === "tool" && s.tool.id === t.id,
          );
          if (idx !== -1) {
            const updated = [...prev];
            const seg = prev[idx] as { kind: "tool"; tool: ToolExecution };
            updated[idx] = {
              kind: "tool",
              tool: {
                ...seg.tool,
                name: seg.tool.name || t.name,
                input: t.input ?? {},
                output: t.output,
                status: t.status,
              },
            };
            return updated;
          }

          return [
            ...prev,
            {
              kind: "tool",
              tool: {
                id: t.id,
                name: t.name,
                input: t.input ?? {},
                output: t.output,
                status: t.status,
              },
            },
          ];
        });
      },
      onToolApprovalRequired: (t) => {

        setApprovals((prev) => ({
          ...prev,
          [t.toolCallId]: { ...t, status: "pending" },
        }));
        const toolPendiente: ToolExecution = {
          id: t.toolCallId,
          name: t.name,
          input: t.commands.length ? { commands: t.commands } : {},
          status: "waiting_approval",
          approvalId: t.approvalId,
        };
        setToolsInFlight((prev) =>
          prev.some((p) => p.id === t.toolCallId)
            ? prev.map((p) =>
              p.id === t.toolCallId
                ? {
                  ...p,
                  status: "waiting_approval",
                  approvalId: t.approvalId,
                }
                : p,
            )
            : [...prev, toolPendiente],
        );

        setStreamSegments((prev) => {
          const idx = prev.findIndex(
            (s) => s.kind === "tool" && s.tool.id === t.toolCallId,
          );
          if (idx === -1) {
            return [...prev, { kind: "tool", tool: toolPendiente }];
          }
          const seg = prev[idx] as {
            kind: "tool";
            tool: ToolExecution;
          };
          const updated = [...prev];
          updated[idx] = {
            kind: "tool",
            tool: {
              ...seg.tool,
              status: "waiting_approval",
              approvalId: t.approvalId,
            },
          };
          return updated;
        });
      },
      onToolApprovalResolved: (t) => {

        setApprovals((prev) => {
          const current = prev[t.toolCallId];
          if (!current) return prev;
          return {
            ...prev,
            [t.toolCallId]: { ...current, status: t.decision },
          };
        });
      },
      onTerminalCommand: (t) => {

        useTerminalStore.getState().enqueueInjection({
          deviceName: t.deviceName,
          commands: t.commands,
          routed: t.routed,
        });
      },
      onTerminalOpenRequested: (t) => {

        setTerminalOpenRequests((prev) =>
          prev.some((r) => r.requestId === t.requestId)
            ? prev
            : [...prev, t],
        );

        if (t.autoOpen) abrirConsola(t);
      },
      onTerminalOpenResolved: (t) => {
        resolveTerminalOpenLocal(t.requestId, t.accepted);
      },
      onAgentProgress: (e) => {
        setAgentProgress(e);
      },
      onReasoning: (t) => {
        setReasoningText((prev) => prev + t.content);
      },
      onHandoff: (t) => {
        setHandoff(t);
      },

      onPlanUpdate: (e) => {
        planTodosRef.current = e.todos;
        setPlanTodos(e.todos);
      },
      onSkillLoading: (e) => {
        setSkillLoading(e);
      },
      onSkillLoaded: () => {

        setSkillLoading(null);
      },
      onSkillCreated: (e) => {
        toast.success(`Skill creada: ${e.title}`);
      },
      onSubagentStarted: (e) => {
        setSubagents((prev) => [
          ...prev.filter((s) => s.name !== e.name),
          e,
        ]);
      },
      onSubagentCompleted: (e) => {
        setSubagents((prev) => [
          ...prev.filter((s) => s.name !== e.name),
          e,
        ]);
      },
      onRagRetrieved: (e) => {
        setRagSources(e);
      },
      onAdminAction: (e) => {
        setAdminActions((prev) => [...prev, e]);
      },
      onError: (msg, code) => {

        marca.errorTurno = { code };

        setToolsInFlight((prev) => reconciliarToolsEnVuelo(prev));
        setStreamSegments((prev) => reconciliarSegmentosEnVuelo(prev));
        if (code === "budget_exhausted") {

          const store = useChatStore.getState();
          setContinuationPending({
            resumen: resumenDeStream(
              streamSegmentsRef.current,
              store.streamingText,
            ),
            pendientes: planTodosRef.current
              .filter((todo) => todo.status !== "completed")
              .map((todo) => todo.content),
          });
        }

        if (code !== "cancelled") toast.error(msg);
      },
      onComplete: (m) => {
        marca.cerradoConComplete = true;
        const recBase = normalizeAssistantComplete(m);
        const s = useChatStore.getState();
        if (!recBase || s.activeChatId !== chatId) return;

        const rec: ChatMessageRecord = {
          ...recBase,
          ...(recBase.segments?.length
            ? { segments: reconciliarSegmentosEnVuelo(recBase.segments) }
            : {}),
          ...(recBase.toolCalls?.length
            ? { toolCalls: reconciliarToolsEnVuelo(recBase.toolCalls) }
            : {}),
        };

        const conSegments = !!rec.segments?.length;
        const liveSegments = reconciliarSegmentosEnVuelo(
          streamSegmentsRef.current,
        );
        const withSegments =
          !conSegments && liveSegments.length > 0 ? liveSegments : undefined;
        const withTools =
          conSegments || withSegments
            ? undefined
            : rec.toolCalls ??
            (toolsInFlightRef.current.length > 0
              ? reconciliarToolsEnVuelo(toolsInFlightRef.current)
              : undefined);
        const withReasoning =
          rec.reasoning ?? (reasoningTextRef.current || undefined);

        const motivoCorte = motivoDeError(marca.errorTurno);
        s.addMessage({
          ...rec,
          ...(withSegments ? { segments: withSegments } : {}),
          ...(withTools ? { toolCalls: withTools } : {}),
          ...(withReasoning ? { reasoning: withReasoning } : {}),
          ...(motivoCorte ? { turnoCorte: motivoCorte } : {}),
        });
      },
    }),
    [abrirConsola, resolveTerminalOpenLocal],
  );

  const cerrarTurno = useCallback(
    (chatId: string, marca: MarcaTurno) => {

      const motivo: MotivoCorte | null = marca.canceladoPorUsuario
        ? "cancelado"
        : motivoDeError(marca.errorTurno);
      setFinalTurno(finalDesdeMotivo(motivo));

      const s = useChatStore.getState();
      if (motivo && s.activeChatId === chatId) {

        corteColaRef.current = { chatId, motivo };
        if (!marca.cerradoConComplete) {

          const parcial = construirRespuestaParcial(s, motivo);
          parcialLocalRef.current = parcial;
          if (parcial) s.addMessage(parcial);
        } else {
          s.setMessages(marcarCorteEnCola(s.messages, motivo));
        }
      }
      s.setStreaming(false);
      s.clearStreamingText();
      setStreamingChatId(null);
      setToolsInFlight([]);
      setStreamSegments([]);
      setReasoningText("");
      setHandoff(null);

      setApprovals({});
      setResolvingApprovals({});
      setAgentProgress(null);
    },
    [construirRespuestaParcial],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      attachments: ChatAttachment[] = [],
    ): Promise<EnvioMensaje> => {
      const trimmed = content.trim();
      if (!trimmed && attachments.length === 0) {
        return { enviado: false, motivo: null };
      }

      const finalContent = trimmed;

      const chatId = await ensureChat(trimmed);
      if (!chatId) return { enviado: false, motivo: "ERROR" };

      const store = useChatStore.getState();

      const modeloDelChat = store.chatModels[chatId];
      const modeloResuelto =
        modeloDelChat === undefined ? store.modelProviderId : modeloDelChat;
      if (modeloDelChat === undefined) {
        store.setChatModel(chatId, modeloResuelto);
      }

      const conexionDelChat = store.chatConnections[chatId];
      const conexionResuelta =
        conexionDelChat === undefined
          ? store.selectedConnectionId
          : conexionDelChat;
      if (conexionDelChat === undefined) {
        store.setChatConnection(chatId, conexionResuelta);
      }

      if (!modeloResuelto || !conexionResuelta) {
        void updateChatSelectionAction(chatId, {
          modelProviderId: modeloResuelto,
          connectionId: conexionResuelta,
        }).catch(() => undefined);
      }

      abrirTurno(chatId);

      const terminalMode = terminalModeRef.current;
      const terminalState = useTerminalStore.getState();

      const terminalTail = terminalTailRef.current?.() ?? null;

      const marca: MarcaTurno = {
        errorTurno: null,
        cerradoConComplete: false,
        canceladoPorUsuario: false,
      };

      const clientMessageId = nuevoClientMessageId();

      let motivoSinEnvio: EnvioMensaje["motivo"] = null;

      let messageIdDuplicado: string | undefined;

      try {
        const resultado = await send(
          chatId,
          {
            content: finalContent,
            clientMessageId,
            autonomousMode,

            ...(conexionResuelta ? { connectionId: conexionResuelta } : {}),
            ...(terminalMode
              ? {
                origin: "terminal",
                ...(terminalState.activeSessionId
                  ? { terminalSessionId: terminalState.activeSessionId }
                  : {}),
              }
              : { origin: "chat" }),
            ...(modeloResuelto ? { modelProviderId: modeloResuelto } : {}),

            ...(terminalTail && terminalTail.lineas > 0 && terminalTail.tail
              ? {
                terminalContextLines: terminalTail.lineas,
                terminalTail: terminalTail.tail,
              }
              : {}),
            ...(attachments.length > 0
              ? {
                attachments: attachments.map((a) => ({
                  fileName: a.fileName,
                  fileType: a.fileType,
                  ...(a.mimeType ? { mimeType: a.mimeType } : {}),
                  ...(a.fileUrl ? { fileUrl: a.fileUrl } : {}),
                })),
              }
              : {}),
          },
          handlersDeTurno(chatId, marca),
        );

        marca.canceladoPorUsuario = resultado.cancelado;
      } catch (error) {

        if (error instanceof ErrorEnvioRechazado) {
          if (error.code === "DUPLICADO") {
            motivoSinEnvio = "DUPLICADO";
            messageIdDuplicado = error.messageId ?? undefined;

            const s = useChatStore.getState();
            const yaEsta = messageIdDuplicado
              ? s.messages.some((m) => m.id === messageIdDuplicado)
              : false;
            if (!yaEsta && error.mensajeExistente) {
              const rec = normalizeChatMessage(error.mensajeExistente);
              if (rec && s.activeChatId === chatId) s.addMessage(rec);
            }
            toast.info(
              "Ese mensaje ya se había enviado: no se ha vuelto a enviar.",
            );
          } else {
            motivoSinEnvio = "TURNO_EN_CURSO";
            avisarTurnoEnCurso();
          }
        } else {
          motivoSinEnvio = "ERROR";
          toast.error(
            error instanceof Error ? error.message : "Error al enviar el mensaje",
          );
        }
      } finally {

        cerrarTurno(chatId, marca);
        void refreshChats();
      }

      return {
        enviado: motivoSinEnvio === null,
        motivo: motivoSinEnvio,
        ...(messageIdDuplicado ? { messageId: messageIdDuplicado } : {}),
      };
    },
    [
      ensureChat,
      send,
      autonomousMode,
      refreshChats,
      abrirTurno,
      handlersDeTurno,
      cerrarTurno,
    ],
  );

  const reintentarTurno = useCallback(
    async (mensajeId: string) => {
      const store = useChatStore.getState();
      if (store.isStreaming) return;
      const chatId = store.activeChatId;
      if (!chatId) {
        toast.info("Abre una conversación para poder reintentar el turno.");
        return;
      }
      const peticion = mensajeUsuarioReintentable(store.messages, mensajeId);
      if (!peticion) {

        const previa = peticionPrecedente(store.messages, mensajeId);
        if (previa?.content.trim()) {
          await sendMessage(previa.content, previa.attachments ?? []);
        }
        return;
      }

      abrirTurno(chatId);
      const marca: MarcaTurno = {
        errorTurno: null,
        cerradoConComplete: false,
        canceladoPorUsuario: false,
      };

      let reenvio: {
        content: string;
        attachments?: ChatAttachment[];
      } | null = null;
      try {

        const resultado = await send(
          chatId,
          { content: "", origin: "chat" },
          handlersDeTurno(chatId, marca),
          { retry: { mensajeUsuarioId: peticion.id } },
        );
        marca.canceladoPorUsuario = resultado.cancelado;
      } catch (error) {
        if (error instanceof ErrorEnvioRechazado) {
          if (error.code === "YA_REINTENTADO") {

            corteColaRef.current = null;
            parcialLocalRef.current = null;
            const s = useChatStore.getState();
            const conciliado = conciliarReintento(
              s.messages,
              error.assistantMessageId,
            );
            if (conciliado.cambio) s.setMessages(conciliado.mensajes);
            toast.info(
              conciliado.yaEsta
                ? "Ese turno ya tiene la respuesta del asistente: no se vuelve a generar."
                : "Ese turno ya estaba respondido: se está actualizando la conversación.",
            );
          } else {
            avisarTurnoEnCurso();
          }
        } else if (error instanceof ErrorReintentoNoResoluble) {

          const previa = peticionPrecedente(
            useChatStore.getState().messages,
            mensajeId,
          );
          if (previa?.content.trim()) {
            reenvio = {
              content: previa.content,
              attachments: previa.attachments ?? [],
            };
          } else {
            toast.error("No se pudo reintentar este turno.");
          }
        } else {
          toast.error(
            error instanceof Error
              ? error.message
              : "No se pudo reintentar el turno",
          );
        }
      } finally {
        cerrarTurno(chatId, marca);
      }

      if (reenvio) {
        await sendMessage(reenvio.content, reenvio.attachments);
        return;
      }

      void refreshChats();
    },
    [abrirTurno, handlersDeTurno, cerrarTurno, send, sendMessage, refreshChats],
  );

  const reintentarTras = useCallback(
    async (mensajeId: string) => {
      const store = useChatStore.getState();
      if (store.isStreaming) return;
      const peticion = peticionPrecedente(store.messages, mensajeId);
      if (!peticion || !peticion.content.trim()) return;
      await sendMessage(peticion.content, peticion.attachments ?? []);
    },
    [sendMessage],
  );

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId],
  );

  const continuarTarea = useCallback(async () => {
    const pendiente = continuationPending;
    if (!pendiente) return;
    if (useChatStore.getState().isStreaming) return;
    const mensaje = construirMensajeContinuacion(pendiente);
    setContinuationPending(null);
    await sendMessage(mensaje);
  }, [continuationPending, sendMessage]);

  const pendingTerminalOpen = terminalOpenRequests[0] ?? null;

  const value = useMemo<ChatContextValue>(
    () => ({
      mounted,
      loadingChats,
      chats,
      hayMasChats: chatsCursor !== null,
      cargarMasChats,
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
      setSelectedConnectionId: seleccionarConexion,
      modelProviderId,
      setModelProviderId: seleccionarModelo,
      models,
      defaultModelId: defaultModelIdState,
      approvals,
      resolvingApprovals,
      approveTool,
      rejectTool,
      terminalOpenRequests,
      planTodos,
      skillLoading,
      subagents,
      ragSources,
      adminActions,
      continuationPending,
      continuarTarea,
      pendingTerminalOpen,
      openTerminalRequest: abrirConsola,
      resolveTerminalOpenLocal,
      autonomousMode,
      setAutonomousMode,
      canApprove,
      canDelete,
      selectChat,
      newChat,
      deleteChat,
      sendMessage,
      stop,
      finalTurno,
      reintentarTurno,
      reintentarTras,
      setTerminalTail,
      setTerminalMode,
    }),
    [
      mounted,
      loadingChats,
      chats,
      chatsCursor,
      cargarMasChats,
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
      seleccionarConexion,
      modelProviderId,
      seleccionarModelo,
      models,
      defaultModelIdState,
      approvals,
      resolvingApprovals,
      approveTool,
      rejectTool,
      terminalOpenRequests,
      planTodos,
      skillLoading,
      subagents,
      ragSources,
      adminActions,
      continuationPending,
      continuarTarea,
      pendingTerminalOpen,
      abrirConsola,
      resolveTerminalOpenLocal,
      autonomousMode,
      setAutonomousMode,
      canApprove,
      canDelete,
      selectChat,
      newChat,
      deleteChat,
      sendMessage,
      stop,
      finalTurno,
      reintentarTurno,
      reintentarTras,
      setTerminalTail,
      setTerminalMode,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatContext debe usarse dentro de <ChatProvider>");
  }
  return ctx;
}
