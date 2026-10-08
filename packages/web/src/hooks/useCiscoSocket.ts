"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface ToolResultPayload {
  tool_call_id?: string;
  [key: string]: unknown;
}

const TOOL_CALL_TIMEOUT_MS = 20_000;

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_BACKEND_URL, {
      withCredentials: true,
      autoConnect: true,
    });
  }
  return socket;
}

function emitToolCall(
  toolName: string,
  toolInput?: Record<string, unknown>,
): Promise<unknown> {
  const s = getSocket();
  if (!s.connected) {
    return Promise.reject(
      new Error("[useCiscoSocket] Sin conexión con el backend"),
    );
  }

  const toolCallId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      s.off("tool_result", onResult);
      reject(
        new Error(
          `[useCiscoSocket] Timeout esperando tool_result para "${toolName}"`,
        ),
      );
    }, TOOL_CALL_TIMEOUT_MS);

    const onResult = (payload: ToolResultPayload) => {
      if (payload?.tool_call_id !== toolCallId) return;
      clearTimeout(timeout);
      s.off("tool_result", onResult);
      resolve(payload.result);
    };

    s.on("tool_result", onResult);
    s.emit("tool_call", {
      tool_call_id: toolCallId,
      tool_name: toolName,
      tool_input: toolInput,
    });
  });
}

function onToolResult(cb: (result: ToolResultPayload) => void): () => void {
  const s = getSocket();
  const handler = (payload: ToolResultPayload) => cb(payload);
  s.on("tool_result", handler);
  return () => {
    s.off("tool_result", handler);
  };
}

export function useCiscoSocket() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    const s = getSocket();

    queueMicrotask(() => {
      if (s.connected) setStatus("connected");
    });

    const onConnect = () => setStatus("connected");
    const onDisconnect = () => setStatus("disconnected");
    const onReconnectAttempt = () => setStatus("connecting");
    const onConnectError = () => setStatus("disconnected");

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.io.on("reconnect_attempt", onReconnectAttempt);
    s.on("connect_error", onConnectError);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.io.off("reconnect_attempt", onReconnectAttempt);
      s.off("connect_error", onConnectError);
    };
  }, []);

  return { socket: getSocket(), status, emitToolCall, onToolResult };
}
