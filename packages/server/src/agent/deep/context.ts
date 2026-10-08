import { z } from "zod";
import type { ConnectionContext } from "../terminal/ConnectionResolver";

export const deepConnectionSchema = z.object({
  name: z.string().nullable().optional(),
  protocol: z.string().nullable().optional(),
  typeDevice: z.string().nullable().optional(),
  alive: z.boolean().default(false),
});

export const deepTurnContextSchema = z.object({

  role: z.string().default("ADMIN"),

  provider: z.string().optional(),

  connection: deepConnectionSchema.nullable().default(null),

  ragPrefetched: z.boolean().default(false),

  webRequired: z.boolean().default(false),

  skillRequested: z.string().nullable().default(null),

  chatId: z.string().optional(),

  origin: z.string().default("chat"),
});

export type DeepTurnContext = z.infer<typeof deepTurnContextSchema>;
export type DeepConnection = z.infer<typeof deepConnectionSchema>;

export function toDeepConnection(
  connection: ConnectionContext | null | undefined,
): DeepConnection | null {
  if (!connection) return null;
  return {
    name: connection.name ?? null,
    protocol: connection.protocol ?? null,
    typeDevice: connection.typeDevice ?? null,
    alive: Boolean(connection.alive),
  };
}

export const DEFAULT_TURN_CONTEXT: DeepTurnContext = deepTurnContextSchema.parse({
  role: "ADMIN",
});
