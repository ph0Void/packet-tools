"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import ChatPrincipalWraper from "@/component/chat/ChatPrincipalWraper";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useChatContext } from "@/context/ChatContext";
import {
  LINEAS_TAIL_TERMINAL,
  useTerminalStore,
  type LineasTailTerminal,
} from "@/store/terminal.store";
import {
  CHAT_PANEL_DEFAULT_WIDTH,
  CHAT_PANEL_MAX_WIDTH,
  CHAT_PANEL_MIN_WIDTH,
  useUiStore,
} from "@/store/uiStore";
import { cn } from "@/lib/utils";

const TAIL_MAX_CHARS = 8000;

const MOBILE_MAX_WIDTH_VW = 90;

function etiquetaLineas(lineas: LineasTailTerminal): string {
  return lineas === 0 ? "Sin salida" : `${lineas} líneas`;
}

export function GlobalChatPanel() {
  const pathname = usePathname();
  const open = useUiStore((s) => s.isChatPanelOpen);
  const closeChatPanel = useUiStore((s) => s.closeChatPanel);
  const width = useUiStore((s) => s.chatPanelWidth);
  const setChatPanelWidth = useUiStore((s) => s.setChatPanelWidth);

  const attachOutput = useTerminalStore((s) => s.attachOutput);
  const setAttachOutput = useTerminalStore((s) => s.setAttachOutput);
  const attachOutputLines = useTerminalStore((s) => s.attachOutputLines);
  const setAttachOutputLines = useTerminalStore((s) => s.setAttachOutputLines);
  const { setTerminalTail, setTerminalMode } = useChatContext();

  const enTerminal = pathname?.startsWith("/dashboard/terminal") ?? false;

  const enPaginaChat = pathname?.startsWith("/dashboard/chat") ?? false;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeChatPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeChatPanel]);

  useEffect(() => {
    if (open && enPaginaChat) closeChatPanel();
  }, [open, enPaginaChat, closeChatPanel]);

  useEffect(() => {
    if (!open || !enTerminal) return;
    setTerminalMode(true);
    return () => setTerminalMode(false);
  }, [open, enTerminal, setTerminalMode]);

  useEffect(() => {
    if (!open || !enTerminal) return;
    setTerminalTail(() => {
      const estado = useTerminalStore.getState();
      if (!estado.attachOutput) return null;
      const lineas = estado.attachOutputLines;
      if (!(lineas > 0)) return null;
      const tail = estado.buffer.slice(-TAIL_MAX_CHARS);
      if (!tail.trim()) return null;
      return { lineas, tail };
    });
    return () => setTerminalTail(null);
  }, [open, enTerminal, setTerminalTail]);

  const arrastrandoRef = useRef(false);
  const [arrastrando, setArrastrando] = useState(false);

  const soltar = useCallback(() => {
    if (!arrastrandoRef.current) return;
    arrastrandoRef.current = false;
    setArrastrando(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMove = (event: PointerEvent) => {
      if (!arrastrandoRef.current) return;

      setChatPanelWidth(window.innerWidth - event.clientX);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", soltar);
    window.addEventListener("pointercancel", soltar);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", soltar);
      window.removeEventListener("pointercancel", soltar);
    };
  }, [open, setChatPanelWidth, soltar]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {

      if (event.button !== 0) return;
      arrastrandoRef.current = true;
      setArrastrando(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [],
  );

  const onKeyDownAsa = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const paso = event.shiftKey ? 64 : 16;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setChatPanelWidth(width + paso);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setChatPanelWidth(width - paso);
      }
    },
    [width, setChatPanelWidth],
  );

  return (

    enPaginaChat ? null : (
      <>

        <div
          onClick={closeChatPanel}
          aria-hidden="true"
          className={cn(
            "fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        />

        <aside
          aria-label="Asistente IA"
          aria-hidden={!open}
          inert={!open}
          style={{
            width: open ? `${width}px` : "0px",
            maxWidth: open ? `${MOBILE_MAX_WIDTH_VW}vw` : "0px",
          }}
          className={cn(
            "relative flex h-full flex-col overflow-hidden border-l border-border/40 bg-background shadow-lg shrink-0",
            "transition-[width] duration-300 ease-in-out",
            arrastrando && "transition-none select-none",
            !open && "border-l-0", // Oculta el borde cuando está colapsado
          )}
        >

          <div
            role="separator"
            aria-label="Ajustar ancho del asistente"
            aria-orientation="vertical"
            aria-valuenow={open ? width : undefined}
            aria-valuemin={CHAT_PANEL_MIN_WIDTH}
            aria-valuemax={CHAT_PANEL_MAX_WIDTH}
            tabIndex={open ? 0 : -1}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDownAsa}
            onDoubleClick={() => setChatPanelWidth(CHAT_PANEL_DEFAULT_WIDTH)}
            className={cn(
              "group absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            )}
          >
            <div className="h-full w-full bg-transparent transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
          </div>

          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/40 px-3">
            <Sparkles className="size-4 shrink-0 text-primary" />
            <span className="truncate text-xs font-semibold tracking-wide text-foreground">
              Asistente IA
            </span>
            <div className="flex-1" />
            {enTerminal && (
              <>
                <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                  <span className="hidden sm:inline">Adjuntar salida</span>
                  <Switch
                    checked={attachOutput}
                    onCheckedChange={setAttachOutput}
                    aria-label="Adjuntar salida de terminal al mensaje"
                  />
                </label>

                <Select
                  value={String(attachOutputLines)}
                  onValueChange={(valor) =>
                    setAttachOutputLines(Number(valor) as LineasTailTerminal)
                  }
                  disabled={!attachOutput}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Líneas de salida de terminal a adjuntar"
                    className="h-6 shrink-0 border-border/40 px-1.5 text-[11px] text-muted-foreground"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINEAS_TAIL_TERMINAL.map((lineas) => (
                      <SelectItem key={lineas} value={String(lineas)}>
                        {etiquetaLineas(lineas)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cerrar asistente"
              onClick={closeChatPanel}
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X />
            </Button>
          </header>

          <div className="min-h-0 flex-1">
            {open && <ChatPrincipalWraper variant="panel" />}
          </div>
        </aside>
      </>
    )
  );
}

export default GlobalChatPanel;
