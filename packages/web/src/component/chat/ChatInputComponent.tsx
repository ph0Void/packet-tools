"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useChatContext, type EnvioMensaje } from "@/context/ChatContext";
import type { ChatAttachment } from "@/hooks/useCiscoChat";
import { getConnectionDevices } from "@/service/TerminalSessionService";
import { getSkills, type Skill } from "@/service/SkillService";
import type { DeviceProvider } from "@/service/DeviceProviderService";
import { toast } from "sonner";

import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputHeader,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { ArrowRight, Ban, Paperclip } from "lucide-react";

import AttachedImagePreviews from "./items/AttachedImagePreviews";
import {
  MentionList,
  insertarMencia,
  useClickOutside,
  useMentionAutocomplete,
  type MentionSkill,
} from "./items/MentionAutocomplete";

const MAX_ATTACHMENTS = 4;

const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;

const CLASE_KBD =
  "rounded border border-border bg-muted/40 px-1 py-px font-mono text-[10.5px] text-muted-foreground";

class EnvioNoRealizado extends Error {
  constructor(motivo: string) {
    super(`El envío no se realizó: ${motivo}`);
    this.name = "EnvioNoRealizado";
  }
}

function AttachButton() {
  const attachments = usePromptInputAttachments();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Adjuntar archivos"
          onClick={() => attachments.openFileDialog()}
          className="size-7 rounded-md cursor-pointer inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150"
        >
          <Paperclip className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        Adjuntar imágenes o documentos ({MAX_ATTACHMENTS} máx.)
      </TooltipContent>
    </Tooltip>
  );
}

interface ChatAgentSelectorProps {
  children?: React.ReactNode;
}

export function ChatInputComponent({ children }: ChatAgentSelectorProps) {
  const {
    sendMessage,
    stop,
    isStreaming,
    messages,
    continuationPending,
    continuarTarea,
    finalTurno,
  } = useChatContext();
  const [devices, setDevices] = useState<DeviceProvider[]>([]);
  const [skills, setSkills] = useState<MentionSkill[]>([]);

  const [texto, setTexto] = useState("");

  const mostrarHints =
    texto.trim().length === 0 && messages.length === 0 && !isStreaming;
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    abierto,
    items,
    resaltado,
    inicio,
    cursor,
    itemResaltado,
    alCambiar,
    alPulsarTecla,
    cerrar,
  } = useMentionAutocomplete(devices, skills);

  useClickOutside(abierto, cerrar, contenedorRef);

  useEffect(() => {
    let vigente = true;
    getConnectionDevices()
      .then((lista) => {
        if (vigente) setDevices(Array.isArray(lista) ? lista : []);
      })
      .catch(() => {

      });
    getSkills()
      .then((res) => {
        if (!vigente) return;
        const lista: Skill[] =
          res.success && Array.isArray(res.data) ? res.data : [];
        setSkills(
          lista.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
          })),
        );
      })
      .catch(() => {

      });
    return () => {
      vigente = false;
    };
  }, []);

  const registrarTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
  }, []);

  const insertarMencion = useCallback(
    (token: string) => {
      const { texto: nuevo, posicion } = insertarMencia(
        texto,
        inicio,
        cursor,
        token,
      );
      setTexto(nuevo);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(posicion, posicion);
      });
    },
    [texto, inicio, cursor],
  );

  const manejarCambio = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const valor = e.currentTarget.value;
      const posicion = e.currentTarget.selectionStart ?? valor.length;
      setTexto(valor);
      alCambiar(valor, posicion);
    },
    [alCambiar],
  );

  const manejarTecla = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!abierto) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        alPulsarTecla(e);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        alPulsarTecla(e);
        if (itemResaltado) {
          e.preventDefault();
          insertarMencion(itemResaltado.token);
        }
        return;
      }
      if (e.key === "Escape") alPulsarTecla(e);
    },
    [abierto, alPulsarTecla, itemResaltado, insertarMencion],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {

      if (isStreaming) throw new EnvioNoRealizado("ya hay un turno en curso");

      const text = message.text ?? "";
      const files = message.files ?? [];
      if (!text.trim() && files.length === 0) {
        throw new EnvioNoRealizado("no hay nada que enviar");
      }

      const attachments: ChatAttachment[] = files.map((f) => {
        const isImage = f.mediaType?.startsWith("image/") ?? false;
        return {
          fileName: f.filename || "archivo",
          fileType: isImage ? "IMAGE" : "DOCUMENT",
          ...(f.mediaType ? { mimeType: f.mediaType } : {}),

          ...(f.url ? { fileUrl: f.url } : {}),
        };
      });

      let resultado: EnvioMensaje;
      try {
        resultado = await sendMessage(text, attachments);
      } catch {

        toast.error("Error al enviar el mensaje", { duration: Infinity });
        throw new EnvioNoRealizado("fallo de red");
      }
      if (!resultado.enviado) {

        throw new EnvioNoRealizado(resultado.motivo ?? "rechazado");
      }

      setTexto("");
    },
    [isStreaming, sendMessage],
  );

  return (
    <TooltipProvider>
      <div className="p-3 sm:p-4 border-t border-border/40 bg-background/80 backdrop-blur-md">

        {continuationPending && !isStreaming && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              El turno se cortó al agotar el presupuesto de pasos. El progreso
              queda guardado: puedes continuar desde donde se quedó.
            </p>
            <button
              type="button"
              id="btn-continue-task"
              onClick={() => void continuarTarea()}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-150 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <ArrowRight className="size-3.5" />
              Continuar tarea
            </button>
          </div>
        )}

        {!isStreaming && finalTurno === "cancelado" && (
          <p className="mb-2 flex items-center gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <Ban className="size-3.5 shrink-0" />
            <span className="min-w-0">
              Turno cancelado: se conserva lo que el agente ya respondió. Puedes
              relanzarlo con «Reintentar», en esa misma respuesta.
            </span>
          </p>
        )}

        <div ref={contenedorRef} className="relative">
          <PromptInput
            onSubmit={handleSubmit}
            multiple
            maxFiles={MAX_ATTACHMENTS}
            maxFileSize={MAX_ADJUNTO_BYTES}

            onError={(err) =>
              toast.error(
                err.code === "max_files"
                  ? `Solo se pueden adjuntar ${MAX_ATTACHMENTS} archivos por mensaje.`
                  : err.code === "max_file_size"
                    ? `Cada archivo debe pesar como máximo ${Math.round(MAX_ADJUNTO_BYTES / (1024 * 1024))} MB.`
                    : "Ese tipo de archivo no se admite: usa imágenes, PDF o texto.",
              )
            }
            accept="image/*,application/pdf,text/plain,text/markdown,text/csv,application/json,.doc,.docx,.xls,.xlsx"

            className="rounded-lg border border-border bg-card shadow-sm transition-all duration-150 focus-within:border-primary/50 focus-within:ring-[3px] focus-within:ring-primary/14"
          >
            <PromptInputHeader>
              <AttachedImagePreviews />
            </PromptInputHeader>

            <PromptInputBody>
              <PromptInputTextarea
                ref={registrarTextarea}
                value={texto}
                placeholder="Escribe tu requerimiento de red. Usa @rag, @web, @skill o @dispositivo…"
                className="max-h-[180px] min-h-[52px] resize-none bg-transparent px-4 pt-[11px] text-[13.5px] placeholder:text-muted-foreground"
                onChange={manejarCambio}
                onKeyDown={manejarTecla}
                onClick={(e) =>
                  alCambiar(
                    e.currentTarget.value,
                    e.currentTarget.selectionStart ?? 0,
                  )
                }
              />
            </PromptInputBody>

            <PromptInputFooter className="px-2 py-[7px]">
              <div className="flex min-w-0 items-center gap-2">{children}</div>

              <PromptInputTools className="justify-end gap-1.5">
                <AttachButton />

                <PromptInputSubmit
                  id="btn-send-message"
                  status={isStreaming ? "streaming" : "ready"}
                  onStop={stop}
                  className="size-7 cursor-pointer rounded-md"
                />
              </PromptInputTools>
            </PromptInputFooter>
          </PromptInput>

          <MentionList
            abierto={abierto}
            items={items}
            resaltado={resaltado}
            onSelect={(item) => {
              cerrar();
              insertarMencion(item.token);
            }}
            className="bottom-full mb-2"
          />
        </div>

        {mostrarHints && (
          <p className="flex items-center gap-1.5 px-1 pt-2 text-[11.5px] text-muted-foreground">
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <kbd className={CLASE_KBD}>Enter</kbd>
              <span>enviar ·</span>
              <kbd className={CLASE_KBD}>Shift</kbd>
              <span>+</span>
              <kbd className={CLASE_KBD}>Enter</kbd>
              <span>salto de línea ·</span>
              <kbd className={CLASE_KBD}>@</kbd>
              <span>menciones</span>
            </span>
            <span className="inline-flex items-center gap-1.5 sm:hidden">
              <kbd className={CLASE_KBD}>Enter</kbd>
              <span>enviar ·</span>
              <kbd className={CLASE_KBD}>@</kbd>
              <span>menciones</span>
            </span>
          </p>
        )}
      </div>
    </TooltipProvider>
  );
}
