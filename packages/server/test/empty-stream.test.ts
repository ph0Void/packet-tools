

import { describe, expect, it } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { withEmptyStreamFallback } from "@/config/ModelProviderConfig";


type ComportamientoStream =
  | "vacio" 
  | "lanza-sin-emitir" 
  | "dos-chunks" 
  | "chunk-y-lanza"; 


class FakeEmptyStreamModel extends BaseChatModel {
  public modelcallsGenerate = 0;

  private readonly comportamiento: ComportamientoStream;
  private readonly textFallback: string;

  constructor(
    comportamiento: ComportamientoStream,
    textFallback = "respuesta completa desde _generate",
  ) {
    super({});
    this.comportamiento = comportamiento;
    this.textFallback = textFallback;
  }

  override _llmType(): string {
    return "fake-empty";
  }

  override async _generate(
    _messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.modelcallsGenerate += 1;
    return {
      generations: [
        {
          text: this.textFallback,
          message: new AIMessage({ content: this.textFallback }),
        },
      ],
    };
  }

  override async *_streamResponseChunks(
    _messages: BaseMessage[],
    _options: this["ParsedCallOptions"],
    _runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    switch (this.comportamiento) {
      case "vacio":
        return;
      case "lanza-sin-emitir":
        throw new Error("stream vacío con error");
      case "dos-chunks":
        yield new ChatGenerationChunk({
          text: "hola ",
          message: new AIMessageChunk({ content: "hola " }),
        });
        yield new ChatGenerationChunk({
          text: "mundo",
          message: new AIMessageChunk({ content: "mundo" }),
        });
        return;
      case "chunk-y-lanza":
        yield new ChatGenerationChunk({
          text: "parcial",
          message: new AIMessageChunk({ content: "parcial" }),
        });
        throw new Error("stream roto tras emitir");
    }
  }
}


async function consumirText(model: BaseChatModel): Promise<string> {
  const parts: string[] = [];
  const stream = await model.stream([new HumanMessage("hola")]);

  for await (const chunk of stream) {
    parts.push(chunk.text);
  }

  return parts.join("");
}

describe("withEmptyStreamFallback", () => {
  it("Caso A: stream vacío → fallback a _generate y respuesta completa", async () => {
    const model = withEmptyStreamFallback(new FakeEmptyStreamModel("vacio"));

    const text = await consumirText(model);

    expect(text).toBe("respuesta completa desde _generate");
    expect(model.modelcallsGenerate).toBe(1);
  });

  it("Caso B: stream que lanza antes de emitir → fallback sin excepción", async () => {
    const model = withEmptyStreamFallback(
      new FakeEmptyStreamModel("lanza-sin-emitir"),
    );

    const text = await consumirText(model);

    expect(text).toBe("respuesta completa desde _generate");
    expect(model.modelcallsGenerate).toBe(1);
  });

  it("Caso C: stream con chunks → NO se llama a _generate", async () => {
    const model = withEmptyStreamFallback(new FakeEmptyStreamModel("dos-chunks"));

    const text = await consumirText(model);

    expect(text).toBe("hola mundo");
    expect(model.modelcallsGenerate).toBe(0);
  });

  it("Caso D: stream que emite y luego lanza → el error se propaga", async () => {
    const model = withEmptyStreamFallback(
      new FakeEmptyStreamModel("chunk-y-lanza"),
    );

    await expect(consumirText(model)).rejects.toThrow("stream roto tras emitir");
    expect(model.modelcallsGenerate).toBe(0);
  });

  it("devuelve el modelo sin tocar cuando no tiene _streamResponseChunks", () => {
    const model = { invoke: () => "sin stream" } as unknown as BaseChatModel;

    expect(withEmptyStreamFallback(model)).toBe(model);
  });
});
