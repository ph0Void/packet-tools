import { randomUUID } from "node:crypto";

export interface TerminalOpenPayload {
  providerId?: string;
  type?: "SSH" | "TELNET" | "SERIAL";
  host?: string;
  port?: number;
  username?: string;
  serialPort?: string;
  baudRate?: number;
  deviceName?: string;
}

export interface TerminalOpenResolution {
  accepted: boolean;
  sessionId?: string | null;
  error?: string | null;
}

export type TerminalOpenStatus = "pending" | "accepted" | "rejected" | "expired";

export interface PendingTerminalOpen {
  requestId: string;
  chatId: string;
  userId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  payload: TerminalOpenPayload;
  createdAt: number;
  expiresAt: number;
  status: TerminalOpenStatus;
  resolve: (result: TerminalOpenResolution) => void;
  timer: NodeJS.Timeout;
}

export type TerminalOpenSnapshot = Omit<PendingTerminalOpen, "resolve" | "timer">;

export interface TerminalOpenRequestMeta {
  chatId: string;
  userId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  payload: TerminalOpenPayload;
}

export interface TerminalOpenRequestOptions {

  ttlMs?: number;

  onPending?: (snapshot: TerminalOpenSnapshot) => void;
}

const DEFAULT_TTL_MS = 60 * 1000;

const SETTLED_RETENTION_MS = 60 * 1000;

export class TerminalOpenBroker {
  private readonly entries = new Map<string, PendingTerminalOpen>();

  request(
    meta: TerminalOpenRequestMeta,
    options: TerminalOpenRequestOptions = {},
  ): Promise<TerminalOpenResolution> {
    this.prune();

    for (const [id, entry] of this.entries) {
      if (
        entry.toolCallId === meta.toolCallId &&
        entry.status === "pending" &&
        entry.chatId === meta.chatId &&
        entry.userId === meta.userId
      ) {
        this.settle(id, "expired", { accepted: false, error: "duplicate" });
      }
    }

    const requestId = randomUUID();
    const now = Date.now();
    const ttlMs =
      typeof options.ttlMs === "number" && options.ttlMs > 0
        ? options.ttlMs
        : DEFAULT_TTL_MS;

    let resolveFn: (result: TerminalOpenResolution) => void = () => {};
    const promise = new Promise<TerminalOpenResolution>((resolve) => {
      resolveFn = resolve;
    });

    const entry: PendingTerminalOpen = {
      requestId,
      chatId: meta.chatId,
      userId: meta.userId,
      toolCallId: meta.toolCallId,
      toolName: meta.toolName,
      summary: meta.summary,
      payload: { ...meta.payload },
      createdAt: now,
      expiresAt: now + ttlMs,
      status: "pending",
      resolve: (result: TerminalOpenResolution) => resolveFn(result),
      timer: setTimeout(() => {
        this.settle(requestId, "expired", { accepted: false, error: "expired" });
      }, ttlMs),
    };

    entry.timer.unref?.();

    this.entries.set(requestId, entry);
    options.onPending?.(this.toSnapshot(entry));

    return promise;
  }

  resolve(
    requestId: string,
    decision: TerminalOpenResolution,
    actor?: { id: string },
  ): PendingTerminalOpen | null {
    const entry = this.entries.get(requestId);
    if (!entry) return null;
    if (actor && actor.id !== entry.userId) return null;
    if (entry.status !== "pending") return entry;
    return this.settle(
      requestId,
      decision.accepted ? "accepted" : "rejected",
      decision,
    );
  }

  get(requestId: string): TerminalOpenSnapshot | null {
    const entry = this.entries.get(requestId);
    return entry ? this.toSnapshot(entry) : null;
  }

  listByChat(chatId: string): TerminalOpenSnapshot[] {
    return [...this.entries.values()]
      .filter((entry) => entry.chatId === chatId)
      .map((entry) => this.toSnapshot(entry));
  }

  cancelChat(chatId: string, reason?: string): number {
    let cancelled = 0;
    for (const [id, entry] of this.entries) {
      if (entry.chatId === chatId && entry.status === "pending") {
        this.settle(id, "rejected", {
          accepted: false,
          error: reason ?? "cancelled",
        });
        cancelled += 1;
      }
    }
    return cancelled;
  }

  clear(): void {
    for (const [id, entry] of this.entries) {
      if (entry.status === "pending") {
        this.settle(id, "expired", { accepted: false, error: "cleared" });
      }
    }
    this.entries.clear();
  }

  prune(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (
        entry.status !== "pending" &&
        now - entry.expiresAt > SETTLED_RETENTION_MS
      ) {
        this.entries.delete(id);
      }
    }
  }

  private settle(
    requestId: string,
    status: Exclude<TerminalOpenStatus, "pending">,
    result: TerminalOpenResolution,
  ): PendingTerminalOpen | null {
    const entry = this.entries.get(requestId);
    if (!entry) return null;
    if (entry.status !== "pending") return entry;
    entry.status = status;
    clearTimeout(entry.timer);
    entry.resolve(result);
    return entry;
  }

  private toSnapshot(entry: PendingTerminalOpen): TerminalOpenSnapshot {
    const { resolve: _resolve, timer: _timer, ...snapshot } = entry;
    return snapshot;
  }
}

export const terminalOpenBroker = new TerminalOpenBroker();
