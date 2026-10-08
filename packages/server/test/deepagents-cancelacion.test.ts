
import { describe, expect, it, vi } from "vitest";

import { buildDeepConfig } from "@/agent/deep/runner";
import { createTurnStream } from "@/agent/deep/turn";
import { deepTurnContextSchema } from "@/agent/deep/context";

describe("DeepAgents: cancelacion por signal", () => {
  it("buildDeepConfig incluye la senal solo si se le pasa", () => {
    const base = {
      threadId: "t1",
      context: deepTurnContextSchema.parse({}),
    };
    expect(buildDeepConfig(base)).not.toHaveProperty("signal");

    const controller = new AbortController();
    const config = buildDeepConfig({ ...base, signal: controller.signal });
    expect(config).toHaveProperty("signal");
    expect((config as { signal?: AbortSignal }).signal).toBe(controller.signal);
  });

  it("un signal abortado queda marcado como tal en la config del grafo", () => {
    const controller = new AbortController();
    controller.abort();
    const config = buildDeepConfig({
      threadId: "t1",
      context: deepTurnContextSchema.parse({}),
      signal: controller.signal,
    });
    
    expect((config as { signal?: AbortSignal }).signal?.aborted).toBe(true);
  });

  it("el stream del supervisor se detiene al abortar y no sigue pidiendo tools", async () => {
    const toolsRequested: string[] = [];
    let abortado = false;

    
    
    const supervisorFake = {
      stream: async (_input: unknown, config: Record<string, unknown>) => {
        const signal = config.signal as AbortSignal | undefined;
        return (async function* () {
          yield { type: "ai", content: "voy a mirar" };
          
          
          if (signal?.aborted) {
            abortado = true;
            return;
          }
          yield {
            type: "tool_call",
            tool_calls: [{ id: "1", name: "send_command", args: {} }],
          };
          toolsRequested.push("send_command");
        })();
      },
    };

    const runner = await import("@/agent/deep/runner");
    vi.spyOn(runner, "getDeepSupervisor").mockResolvedValue(
      supervisorFake as never,
    );

    const controller = new AbortController();
    const { stream } = await createTurnStream({
      messages: [],
      chatId: "chat1",
      messageId: "m1",
      role: "ADMIN",
      provider: "default",
      emit: () => undefined,
      signal: controller.signal,
    });

    
    controller.abort();
    for await (const _chunk of stream as AsyncIterable<unknown>) {
      
    }

    expect(abortado, "el stream debe observar la senal abortada").toBe(true);
    expect(
      toolsRequested,
      "no debe pedir herramientas tras abortar (comandos fantasma)",
    ).toEqual([]);
  });
});
