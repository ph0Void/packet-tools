export interface AlertRow {
    id: string;
    title: string;
    description: string;
    severity: string;
    resolved: boolean;
    createdAt: string | Date;
    topologyId: string | null;
    topology?: { name: string } | null;
    user?: { username: string } | null;
}

export function severityBadgeClass(severity: string): string {
    switch (severity?.toUpperCase()) {
        case "CRITICAL":
            return "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400";
        case "HIGH":
            return "bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400";
        case "MEDIUM":
            return "bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400";
        case "LOW":
            return "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400";
        default:
            return "bg-sky-500/10 border-sky-500/20 text-sky-600 dark:text-sky-400";
    }
}
