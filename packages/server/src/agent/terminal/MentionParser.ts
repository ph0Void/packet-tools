import { prismaClient } from "@/prisma/lib/PrismaClient";
import { terminalSessionHub } from "@/sockets/TerminalSessionHub";

export interface MentionResolution {

  token: string | null;
  sessionId: string | null;
  providerId: string | null;
  deviceName: string | null;

  rag: boolean;

  web: boolean;

  skill: string | null;
}

const MENCION_RESERVADA_RAG = "rag";
const MENCION_RESERVADA_WEB = "web";
const MENCION_RESERVADA_SKILL = "skill";

function esReservada(token: string): boolean {
  const normalizado = token.toLowerCase();
  return (
    normalizado === MENCION_RESERVADA_RAG ||
    normalizado === MENCION_RESERVADA_WEB ||
    normalizado === MENCION_RESERVADA_SKILL
  );
}

export function extractMentions(content: string): string[] {
  return [...String(content ?? "").matchAll(/@([A-Za-z0-9._-]+)/g)].map(
    (match) => match[1],
  );
}

export function hasRagMention(content: string): boolean {
  return extractMentions(content).some(
    (token) => token.toLowerCase() === MENCION_RESERVADA_RAG,
  );
}

export function hasWebMention(content: string): boolean {
  return extractMentions(content).some(
    (token) => token.toLowerCase() === MENCION_RESERVADA_WEB,
  );
}

export function extractSkillMention(content: string): string | null {
  const match = /@skill:([A-Za-z0-9._-]+)/i.exec(String(content ?? ""));
  return match ? match[1].toLowerCase() : null;
}

export function extractMention(content: string): string | null {
  return extractMentions(content).find((token) => !esReservada(token)) ?? null;
}

function findMatch<T>(
  items: readonly T[],
  valuesOf: (item: T) => Array<string | null | undefined>,
  needle: string,
): T | null {
  let prefijo: T | null = null;
  for (const item of items) {
    for (const value of valuesOf(item)) {
      const texto = String(value ?? "").trim().toLowerCase();
      if (!texto) continue;
      if (texto === needle) return item;
      if (!prefijo && texto.startsWith(needle)) prefijo = item;
    }
  }
  return prefijo;
}

export async function resolveMention(
  content: string,
  userId: string,
): Promise<MentionResolution> {
  const rag = hasRagMention(content);
  const web = hasWebMention(content);
  const skill = extractSkillMention(content);

  const token = extractMention(content);
  if (!token) {
    return {
      token: null,
      sessionId: null,
      providerId: null,
      deviceName: null,
      rag,
      web,
      skill,
    };
  }

  const needle = token.toLowerCase();

  const sesion = findMatch(
    terminalSessionHub.listSessions(userId),
    (session) => [session.deviceName],
    needle,
  );
  if (sesion) {
    return {
      token,
      sessionId: sesion.sessionId,
      providerId: sesion.providerId,
      deviceName: sesion.deviceName,
      rag,
      web,
      skill,
    };
  }

  const proveedores = await prismaClient.deviceProviders.findMany({
    select: {
      id: true,
      name: true,
      protocol: true,
      host: true,
      serialPort: true,
    },
  });
  const proveedor = findMatch(
    proveedores,
    (device) => [device.name, device.host, device.serialPort],
    needle,
  );
  if (proveedor) {
    return {
      token,
      sessionId: null,
      providerId: proveedor.id,
      deviceName: proveedor.name,
      rag,
      web,
      skill,
    };
  }

  return {
    token,
    sessionId: null,
    providerId: null,
    deviceName: null,
    rag,
    web,
    skill,
  };
}
