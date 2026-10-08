import type { BaseMessage } from "@langchain/core/messages";
import { buildDeepConfig, getDeepSupervisor, logDeepTurnTokens } from "./runner";
import {
  loadSkillsFromKnowledgeBase,
  type SkillDocument,
} from "../skills/loader";
import { toDeepConnection, type DeepTurnContext } from "./context";
import { Logger } from "@/utils/Logger";
import { envConfig } from "@/config/EnvConfig";
import type { ConnectionContext } from "../terminal/ConnectionResolver";
import { crearEspecialistaDeTerminal, FAST_PATH_SUBAGENTS } from "./fastPathAgent";
import { decidirFastPath } from "./fastPath";
import { fastPathStream } from "./fastPathStream";
import { crearRelojDeTurno, streamConPlazo } from "./turnPlazo";

export interface TurnStreamArgs {

  messages: BaseMessage[];
  chatId: string;

  messageId: string;
  role: string;
  modelProviderId?: string;

  provider?: string;
  connectionType?: string;
  connection?: ConnectionContext | null;

  ragPrefetched: boolean;

  webRequired: boolean;

  skillRequested?: string | null;
  origin: string;
  signal?: AbortSignal;

  turnTimeoutMs?: number | null;

  emit?: (event: string, data: unknown) => void;
}

export interface TurnStream {
  stream: AsyncIterable<unknown>;

  threadId: string;

  deep: boolean;
}

function buildTurnContext(args: TurnStreamArgs): DeepTurnContext {
  return {
    role: args.role,
    provider: args.provider,
    connection: toDeepConnection(args.connection),
    ragPrefetched: args.ragPrefetched,
    webRequired: args.webRequired,
    skillRequested: args.skillRequested ?? null,
    chatId: args.chatId,
    origin: args.origin,
  };
}

const MAX_CHARS_POR_SKILL = 24_000;

const MAX_CHARS_POR_TURNO = 120_000;

const AVISO_TRUNCADO =
  "\n\n[AVISO: SKILL.md truncado por el presupuesto de contexto del turno. Si el procedimiento está incompleto, dilo al usuario en lugar de suponer pasos.]";

interface FicheroVirtual {
  content: string;
  mimeType: string;
  created_at: string;
  modified_at: string;
}

export function buildTurnFiles(
  skills: SkillDocument[],
  skillRequested?: string | null,
): Record<string, FicheroVirtual> {
  const files: Record<string, FicheroVirtual> = {};
  let gastado = 0;
  let truncadas = 0;

  const ordenadas = [...skills].sort((a, b) => {
    if (a.name === skillRequested) return -1;
    if (b.name === skillRequested) return 1;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  for (const skill of ordenadas) {
    if (gastado >= MAX_CHARS_POR_TURNO) {
      truncadas += 1;
      continue;
    }
    const limite = Math.min(
      MAX_CHARS_POR_SKILL,
      Math.max(0, MAX_CHARS_POR_TURNO - gastado),
    );
    if (skill.content.length > limite) truncadas += 1;
    const contenido =
      skill.content.length > limite
        ? skill.content.slice(0, limite) + AVISO_TRUNCADO
        : skill.content;
    gastado += contenido.length;
    const fecha = skill.updatedAt.toISOString();
    files[skill.path] = {
      content: contenido,
      mimeType: "text/markdown",
      created_at: fecha,
      modified_at: fecha,
    };
  }

  if (truncadas > 0) {
    Logger.warning({
      message:
        "[SKILLS] Presupuesto de skills agotado: SKILL.md recortados u omitidos",
      data: {
        skills: skills.length,
        proyectadas: Object.keys(files).length,
        recortadasOmitidas: truncadas,
        chars: gastado,
        maxCharsTurno: MAX_CHARS_POR_TURNO,
        solicitada: skillRequested ?? null,
      },
    });
  }

  return files;
}

async function loadTurnFiles(
  skillRequested?: string | null,
): Promise<Record<string, FicheroVirtual>> {
  const skills = await loadSkillsFromKnowledgeBase();
  return buildTurnFiles(skills, skillRequested);
}

function textoDelUsuario(mensajes: BaseMessage[]): string {
  for (let indice = mensajes.length - 1; indice >= 0; indice -= 1) {
    const mensaje = mensajes[indice];
    if (mensaje?.getType?.() !== "human") continue;
    const contenido = (mensaje as { content?: unknown }).content;
    if (typeof contenido === "string") return contenido;
    if (Array.isArray(contenido)) {
      return contenido
        .map((parte) =>
          parte && typeof parte === "object" && "text" in parte
            ? String((parte as { text?: unknown }).text ?? "")
            : "",
        )
        .join("");
    }
  }
  return "";
}

export async function createTurnStream(
  args: TurnStreamArgs,
): Promise<TurnStream> {
  const threadId = `${args.chatId}:${args.messageId}`;

  logDeepTurnTokens(args.messages);

  const reloj = crearRelojDeTurno({ limiteMs: args.turnTimeoutMs, signal: args.signal });

  const configGrafo = () => ({
    ...buildDeepConfig({
      threadId,
      context: buildTurnContext(args),
      signal: reloj.signal,
      deadlineAt: reloj.deadlineAt,
      plazoMs: reloj.limiteMs,
    }),

    streamMode: "messages" as never,
    subgraphs: true,
  });

  const decision = decidirFastPath({
    enabled: envConfig.FAST_PATH_ENABLED,
    origin: args.origin,
    role: args.role,
    connection: toDeepConnection(args.connection),
    textoUsuario: textoDelUsuario(args.messages),
    ragPrefetched: args.ragPrefetched,
    webRequired: args.webRequired,
    skillRequested: args.skillRequested,
  });
  if (decision.ir && decision.especialista) {
    const especialista = await crearEspecialistaDeTerminal({
      especialista: decision.especialista,
      modelProviderId: args.modelProviderId,
      role: args.role,
    });
    if (especialista) {
      Logger.info({
        message: "[FAST_PATH] Turno servido por el especialista sin supervisor",
        data: {
          chatId: args.chatId,
          messageId: args.messageId,
          especialista: FAST_PATH_SUBAGENTS[decision.especialista],
          motivo: decision.motivo,
          role: args.role,
        },
      });
      const config = {
        ...buildDeepConfig({
          threadId,
          context: buildTurnContext(args),
          signal: reloj.signal,
          deadlineAt: reloj.deadlineAt,
          plazoMs: reloj.limiteMs,
        }),
        streamMode: "messages" as never,
      };
      const streamEspecialista = await (
        especialista as unknown as {
          stream(i: unknown, c: unknown): Promise<AsyncIterable<unknown>>;
        }
      ).stream({ messages: args.messages }, config);
      const stream = fastPathStream({
        especialista: streamEspecialista,
        etiqueta: FAST_PATH_SUBAGENTS[decision.especialista],
        supervisor: async () => {
          const supervisor = await getDeepSupervisor({
            modelProviderId: args.modelProviderId,
            role: args.role,
            connection: toDeepConnection(args.connection),
          });
          const files = await loadTurnFiles(args.skillRequested);
          return (
            supervisor as unknown as {
              stream(i: unknown, c: unknown): Promise<AsyncIterable<unknown>>;
            }
          ).stream(
            {
              messages: args.messages,
              ...(Object.keys(files).length > 0 ? { files } : {}),
            },
            configGrafo(),
          );
        },
      });
      return {
        stream: streamConPlazo({ stream, reloj, threadId, etiqueta: "fast_path" }),
        threadId,
        deep: true,
      };
    }
    Logger.info({
      message: "[FAST_PATH] Sin agente de especialista; se sigue con el supervisor",
      data: { motivo: decision.motivo },
    });
  }

  const supervisor = await getDeepSupervisor({
    modelProviderId: args.modelProviderId,
    role: args.role,
    connection: toDeepConnection(args.connection),
  });

  const files = await loadTurnFiles(args.skillRequested);
  const input = {
    messages: args.messages,
    ...(Object.keys(files).length > 0 ? { files } : {}),
  };
  const config = configGrafo();

  const streamBase = await (
    supervisor as unknown as {
      stream(i: unknown, c: unknown): Promise<AsyncIterable<unknown>>;
    }
  ).stream(input, config);

  const stream = streamConPlazo({ stream: streamBase, reloj, threadId, etiqueta: "supervisor" });

  return { stream, threadId, deep: true };
}

export async function invokeTurn(args: TurnStreamArgs): Promise<{
  messages: BaseMessage[];
  deep: boolean;
}> {
  const reloj = crearRelojDeTurno({ limiteMs: args.turnTimeoutMs, signal: args.signal });
  try {
    const supervisor = await getDeepSupervisor({
      modelProviderId: args.modelProviderId,
      role: args.role,
      connection: toDeepConnection(args.connection),
    });
    const files = await loadTurnFiles(args.skillRequested);
    const result = (await supervisor.invoke(
      {
        messages: args.messages,
        ...(Object.keys(files).length > 0 ? { files } : {}),
      },
      buildDeepConfig({
        threadId: `${args.chatId}:${args.messageId}`,
        context: buildTurnContext(args),
        signal: reloj.signal,
        deadlineAt: reloj.deadlineAt,
        plazoMs: reloj.limiteMs,
      }),
    )) as { messages?: BaseMessage[] };
    return { messages: result.messages ?? [], deep: true };
  } finally {
    reloj.detener();
  }
}
