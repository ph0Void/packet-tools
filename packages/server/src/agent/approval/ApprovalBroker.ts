import { randomUUID } from "node:crypto";

export type ApprovalDecision = "approved" | "rejected" | "expired";

export interface PendingApproval {
  approvalId: string;
  chatId: string;
  userId: string;
  toolCallId: string;
  toolName: string;
  toolLabel: string;
  commands: string[];
  deviceName: string | null;
  providerId: string | null;
  summary: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | ApprovalDecision;
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

export type ApprovalSnapshot = Omit<PendingApproval, "resolve" | "timer">;

export interface ApprovalRequestMeta {
  chatId: string;
  userId: string;
  toolCallId: string;
  toolName: string;
  toolLabel: string;
  commands?: string[];
  deviceName?: string | null;
  providerId?: string | null;
  summary?: string;
  timeoutMs?: number;
}

export interface ApprovalRequestOptions {

  onPending?: (snapshot: ApprovalSnapshot) => void;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const SETTLED_RETENTION_MS = 60 * 1000;

export class ApprovalBroker {
  private readonly entries = new Map<string, PendingApproval>();

  request(
    meta: ApprovalRequestMeta,
    options: ApprovalRequestOptions = {},
  ): Promise<ApprovalDecision> {
    this.pruneSettled();

    for (const [id, entry] of this.entries) {

      if (
        entry.toolCallId === meta.toolCallId &&
        entry.status === "pending" &&
        entry.chatId === meta.chatId &&
        entry.userId === meta.userId
      ) {
        this.settle(id, "expired");
      }
    }

    const approvalId = randomUUID();
    const now = Date.now();
    const timeoutMs =
      typeof meta.timeoutMs === "number" && meta.timeoutMs > 0
        ? meta.timeoutMs
        : DEFAULT_TIMEOUT_MS;

    let resolveFn: (decision: ApprovalDecision) => void = () => {};
    const promise = new Promise<ApprovalDecision>((resolve) => {
      resolveFn = resolve;
    });

    const entry: PendingApproval = {
      approvalId,
      chatId: meta.chatId,
      userId: meta.userId,
      toolCallId: meta.toolCallId,
      toolName: meta.toolName,
      toolLabel: meta.toolLabel,
      commands: Array.isArray(meta.commands) ? [...meta.commands] : [],
      deviceName: meta.deviceName ?? null,
      providerId: meta.providerId ?? null,
      summary: meta.summary ?? "",
      createdAt: now,
      expiresAt: now + timeoutMs,
      status: "pending",
      resolve: (decision: ApprovalDecision) => resolveFn(decision),
      timer: setTimeout(() => {
        this.settle(approvalId, "expired");
      }, timeoutMs),
    };

    entry.timer.unref?.();

    this.entries.set(approvalId, entry);
    options.onPending?.(this.toSnapshot(entry));

    return promise;
  }

  resolve(
    approvalId: string,
    decision: "approved" | "rejected",
    actor?: { id: string },
  ): PendingApproval | null {
    const entry = this.entries.get(approvalId);
    if (!entry) return null;
    if (actor && actor.id !== entry.userId) return null;
    if (entry.status !== "pending") return entry;
    return this.settle(approvalId, decision);
  }

  get(approvalId: string): ApprovalSnapshot | null {
    const entry = this.entries.get(approvalId);
    return entry ? this.toSnapshot(entry) : null;
  }

  listByChat(chatId: string): ApprovalSnapshot[] {
    return [...this.entries.values()]
      .filter((entry) => entry.chatId === chatId)
      .map((entry) => this.toSnapshot(entry));
  }

  cancelChat(chatId: string, _reason?: string): number {
    let cancelled = 0;
    for (const [id, entry] of this.entries) {
      if (entry.chatId === chatId && entry.status === "pending") {
        this.settle(id, "rejected");
        cancelled += 1;
      }
    }
    return cancelled;
  }

  clear(): void {
    for (const [id, entry] of this.entries) {
      if (entry.status === "pending") this.settle(id, "expired");
    }
    this.entries.clear();
  }

  private settle(
    approvalId: string,
    decision: ApprovalDecision,
  ): PendingApproval | null {
    const entry = this.entries.get(approvalId);
    if (!entry) return null;
    if (entry.status !== "pending") return entry;
    entry.status = decision;
    clearTimeout(entry.timer);
    entry.resolve(decision);
    return entry;
  }

  private toSnapshot(entry: PendingApproval): ApprovalSnapshot {
    const { resolve: _resolve, timer: _timer, ...snapshot } = entry;
    return snapshot;
  }

  private pruneSettled(): void {
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
}

export const approvalBroker = new ApprovalBroker();
