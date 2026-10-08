import type { Tone } from "./dashboard/item/ItemCard";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

const SEVERITY: Record<string, Tone> = {
    CRITICAL: "critical",
    HIGH: "warning",
    MEDIUM: "warning",
    LOW: "info",
};

export const SEVERITY_BADGE: Record<string, string> = {
    CRITICAL: "bg-critical/12 text-critical border-critical/30",
    HIGH: "bg-high/12 text-high border-high/30",
    MEDIUM: "bg-medium/15 text-medium border-medium/35",
    LOW: "bg-low/12 text-low border-low/30",
};

export function severityTone(severity?: string | null): Tone {
    return SEVERITY[(severity ?? "").toUpperCase()] ?? "idle";
}

const RANK: Record<Tone, number> = {
    critical: 3,
    warning: 2,
    success: 1,
    info: 0,
    idle: -1,
};

export function worstTone(severities: (string | null | undefined)[]): Tone {
    return severities.reduce<Tone>((worst, s) => {
        const tone = severityTone(s);
        return RANK[tone] > RANK[worst] ? tone : worst;
    }, "idle");
}
