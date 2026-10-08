"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  Cable,
  Clock,
  Database,
  LayoutDashboard,
  Logs,
  MessageCircleWarning,
  MessageSquare,
  Network,
  Router,
  Settings,
  Sparkles,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import { envConfig } from "@/config/EnvConfig";

interface MenuItem {
  name: string;
  path: string;
  icon: LucideIcon;
}

const MENU_ITEMS: MenuItem[] = [
  { name: "Inicio", path: "/dashboard", icon: LayoutDashboard },
  { name: "Alertas", path: "/dashboard/alert", icon: MessageCircleWarning },
  { name: "Chat", path: "/dashboard/chat", icon: MessageSquare },
  { name: "Conexiones", path: "/dashboard/connection", icon: Router },
  { name: "Terminal", path: "/dashboard/terminal", icon: Terminal },
  { name: "Automatizaciones", path: "/dashboard/jobs", icon: Clock },
  { name: "Skills", path: "/dashboard/skills", icon: Sparkles },
  { name: "Logs", path: "/dashboard/log", icon: Logs },
  { name: "Manual", path: "/dashboard/resources", icon: BookOpen },
];

const ADMIN_MENU_ITEMS: MenuItem[] = [
  { name: "Datos", path: "/dashboard/data", icon: Database },
  { name: "Usuarios", path: "/dashboard/users", icon: Users },
  { name: "Configuración", path: "/dashboard/configuration", icon: Settings },
];

function isActivePath(pathname: string, itemPath: string): boolean {
  if (itemPath === "/dashboard") return pathname === "/dashboard";
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

export default function SideBar() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const isMenuOpen = useUiStore((state) => state.isMenuOpen);
  const closeMenu = useUiStore((state) => state.closeMenu);

  const isAdmin = user?.role === "ADMIN";
  const menuItems = isAdmin ? [...MENU_ITEMS, ...ADMIN_MENU_ITEMS] : MENU_ITEMS;

  return (
    <>
      {isMenuOpen && (
        <div
          aria-hidden="true"
          onClick={closeMenu}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 md:static",
          isMenuOpen
            ? "translate-x-0 w-64 md:w-64"
            : "-translate-x-full md:translate-x-0 md:w-16",
        )}
      >

        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4">
          <span
            className="pipe flex size-9 shrink-0 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent"
            data-pipe="info"
          >
            <Activity className="size-5 text-sidebar-primary" />
          </span>
          {isMenuOpen && (

            <h1 className="flex items-center gap-1.5 font-heading text-sm font-bold tracking-tight text-sidebar-primary">
              <span className="truncate">PACKET TOOLS AI</span>
              <span className="shrink-0 font-mono text-xs font-medium text-muted-foreground">
                [{envConfig.VERSION || "v1.0.0"}]
              </span>
            </h1>
          )}
        </div>

        <nav
          aria-label="Navegación principal"
          className="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2.5"
        >
          {menuItems.map((item) => {
            const isActive = isActivePath(pathname, item.path);
            const Icon = item.icon;

            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={closeMenu}
                title={item.name}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-150",
                  isMenuOpen && "pr-3",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >

                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-y-1.5 left-0 w-0.5 rounded-full transition-opacity duration-150",
                    isActive ? "bg-sidebar-primary opacity-100" : "opacity-0",
                  )}
                />
                <Icon
                  className={cn(
                    "size-[1.125rem] shrink-0 transition-colors duration-150",
                    isActive
                      ? "text-sidebar-primary"
                      : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground",
                  )}
                />
                {isMenuOpen && (
                  <span
                    className={cn(
                      "truncate text-[0.8125rem]",
                      isActive ? "font-semibold" : "font-medium",
                    )}
                  >
                    {item.name}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-2.5">
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5",
              !isMenuOpen && "justify-center px-0",
            )}
            title={user?.username}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[0.6875rem] font-semibold tracking-wide text-sidebar-primary">
              {(user?.username ?? "?").substring(0, 2).toUpperCase()}
            </span>
            {isMenuOpen && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-semibold text-sidebar-foreground">
                  {user?.username ?? "Invitado"}
                </p>
                <p className="eyebrow mt-0.5">{user?.role ?? "—"}</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
