import Link from "next/link";
import {
  Terminal,
  MessagesSquare,
  HardDrive,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";

const links = [
  {
    href: "/dashboard/terminal",
    label: "Terminal",
    description: "Consolas SSH y Telnet",
    icon: Terminal,
  },
  {
    href: "/dashboard/chat",
    label: "Chat IA",
    description: "Asistente de red",
    icon: MessagesSquare,
  },
  {
    href: "/dashboard/skills",
    label: "Skills",
    description: "Nuevas capacidades del agente",
    icon: Sparkles,
  },
  {
    href: "/dashboard/connection",
    label: "Conexiones",
    description: "Dispositivos y servicios configurados",
    icon: HardDrive,
  },
];

export default function QuickAccess() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="panel group flex items-center gap-3 p-3.5 transition-colors duration-200 hover:border-primary/40 hover:bg-accent/40"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors duration-200 group-hover:bg-primary/10 group-hover:text-primary [&_svg]:size-[1.125rem]">
            <link.icon />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate font-heading text-sm font-semibold text-foreground">
              {link.label}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {link.description}
            </span>
          </span>

          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/50 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
        </Link>
      ))}
    </div>
  );
}
