"use client";

import { usePathname, useRouter } from "next/navigation";
import { Activity, LogOut, Menu, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { logoutAction } from "@/action/AuthAction";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";
import { useTopologyStore } from "@/store/topologyStore";
import { useCiscoSocket } from "@/hooks/useCiscoSocket";
import { cn } from "@/lib/utils";
import ToggleTheme from "./ToggleTheme";

const SOCKET_STATUS_CONFIG = {
  connected: {
    label: "Conectado",
    title: "Conexión con el backend establecida",
    dotClass: "bg-success",
    textClass: "text-success",
  },
  connecting: {
    label: "Conectando",
    title: "Estableciendo conexión con el backend...",
    dotClass: "bg-warning animate-pulse",
    textClass: "text-warning",
  },
  disconnected: {
    label: "Desconectado",
    title: "Sin conexión con el backend",
    dotClass: "bg-destructive",
    textClass: "text-destructive",
  },
} as const;

export default function NavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const isMenuOpen = useUiStore((state) => state.isMenuOpen);
  const openMenu = useUiStore((state) => state.openMenu);
  const closeMenu = useUiStore((state) => state.closeMenu);
  const isChatPanelOpen = useUiStore((state) => state.isChatPanelOpen);
  const toggleChatPanel = useUiStore((state) => state.toggleChatPanel);
  const clearStore = useTopologyStore((state) => state.clearStore);
  const { status } = useCiscoSocket();

  const socketStatus = SOCKET_STATUS_CONFIG[status];
  const chatEnPantallaCompleta =
    pathname?.startsWith("/dashboard/chat") ?? false;

  const handleLogout = async () => {
    try {
      await logoutAction();
      clearStore();
      setUser(null);
      router.replace("/auth");
      router.refresh();
    } catch {
      toast.error("No se pudo cerrar sesión. Inténtalo de nuevo.");
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md transition-colors duration-200 md:px-6">
      <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
        <button
          type="button"
          onClick={isMenuOpen ? closeMenu : openMenu}
          aria-label={isMenuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={isMenuOpen}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground"
        >
          <Menu className="size-5" />
        </button>

        <h2 className="truncate font-heading text-sm font-semibold tracking-tight text-foreground md:text-base">
          Tu asistente inteligente de redes
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-2 md:gap-3">
        <div
          title={socketStatus.title}
          className={cn(
            "flex items-center gap-2 rounded-full border border-border bg-muted px-2.5 py-1.5",
            socketStatus.textClass,
          )}
        >
          <span
            aria-hidden="true"
            className={cn("size-2 rounded-full", socketStatus.dotClass)}
          />
          <span className="eyebrow hidden sm:inline">{socketStatus.label}</span>
          <span className="sr-only">{socketStatus.label}</span>
        </div>

        <ToggleTheme />

        {!chatEnPantallaCompleta && (
          <button
            type="button"
            onClick={toggleChatPanel}
            aria-label={
              isChatPanelOpen ? "Cerrar asistente IA" : "Abrir asistente IA"
            }
            aria-pressed={isChatPanelOpen}
            title={
              isChatPanelOpen ? "Cerrar asistente IA" : "Abrir asistente IA"
            }
            className={cn(
              "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors duration-200",
              isChatPanelOpen
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <MessageSquare className="size-4" />
          </button>
        )}

        <div className="hidden items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 md:flex">
          <span className="max-w-32 truncate text-[0.8125rem] font-medium text-foreground">
            {user?.username ?? "Invitado"}
          </span>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors duration-200 hover:border-destructive/25 hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
