import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface ChatAttachment {
  id: string;

  url: string | null;
  name: string;
  contentType?: string | null;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: string;
  content: string;
  attachments?: ChatAttachment[];
  createdAt?: string;
}

export interface Chat {
  id: string;
  title: string;
  userId: string;

  messages?: ChatMessage[];
  messageCount?: number;
  attachmentCount?: number;

  modelProviderId?: string | null;

  connectionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatListMeta {
  limit: number | null;
  nextCursor: string | null;
  hasMore: boolean;
  count: number;
}

export interface ChatSelectionPayload {
  modelProviderId?: string | null;
  connectionId?: string | null;
}

export function getChats(opciones: {
  includeMessages?: boolean;
  limit?: number;
  cursor?: string | null;
} = {}): Promise<ApiResponse<Chat[]>> {
  const query = new URLSearchParams();
  if (opciones.includeMessages) query.set("include", "messages");
  if (typeof opciones.limit === "number") {
    query.set("limit", String(opciones.limit));
  }
  if (opciones.cursor) query.set("cursor", opciones.cursor);
  const suffix = query.toString();
  return api<Chat[]>(suffix ? `/api/chats?${suffix}` : "/api/chats");
}

export function createChat(
  title?: string,
  selection?: ChatSelectionPayload,
): Promise<ApiResponse<Chat>> {
  return api<Chat>("/api/chats", {
    method: "POST",
    body: JSON.stringify({
      title: title || "Nueva sesión de red",
      ...(selection ?? {}),
    }),
  });
}

export function updateChatSelection(
  chatId: string,
  payload: ChatSelectionPayload,
): Promise<ApiResponse<Chat>> {
  return api<Chat>(`/api/chats/${chatId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getMessages(chatId: string): Promise<ApiResponse<ChatMessage[]>> {
  return api<ChatMessage[]>(`/api/chats/${chatId}/messages`);
}

export function deleteChat(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/chats/${id}`, { method: "DELETE" });
}
