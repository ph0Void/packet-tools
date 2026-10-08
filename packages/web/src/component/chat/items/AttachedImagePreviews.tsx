"use client";

import type { ChatAttachment } from "@/hooks/useCiscoChat";
import { usePromptInputAttachments } from "@/components/ai-elements/prompt-input";
import {
  esImagenServible,
  tieneContenidoServible,
  urlDeAdjunto,
} from "@/component/chat/adjuntos";
import { Download, FileText, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface StaticPreviewProps {
  attachments: ChatAttachment[];
  align?: "start" | "end";
  className?: string;
}

function extension(fileName?: string): string {
  return (fileName?.split(".").pop() ?? "doc").slice(0, 5);
}

function MiniaturaAdjunto({ att }: { att: ChatAttachment }) {
  const [fallo, setFallo] = useState(false);
  const url = tieneContenidoServible(att) ? urlDeAdjunto(att.id as string) : null;

  if (!url || fallo || !esImagenServible(att)) {
    const ficha = (
      <>
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate text-xs text-muted-foreground">
            {att.fileName}
          </span>
          <span className="block truncate text-[10px] uppercase font-mono text-muted-foreground/70">
            {url ? extension(att.fileName) : "no disponible"}
          </span>
        </span>
        {url && (
          <Download className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        )}
      </>
    );
    const clases =
      "flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 max-w-[220px] transition-colors";
    return url ? (

      <a
        href={url}
        download={att.fileName}
        title={`Descargar ${att.fileName}`}
        className={cn(clases, "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring")}
      >
        {ficha}
      </a>
    ) : (
      <div
        className={clases}
        title="El contenido de este adjunto ya no está disponible"
      >
        {ficha}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={att.fileName}
      loading="lazy"
      onError={() => setFallo(true)}
      className="max-h-44 max-w-[220px] rounded-lg object-cover border border-border shadow-sm"
    />
  );
}

function StaticPreviews({ attachments, align = "start", className }: StaticPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-2",
        align === "end" ? "justify-end" : "justify-start",
        className,
      )}
    >
      {attachments.map((att, idx) => (
        <MiniaturaAdjunto
          key={att.id ?? `${att.fileName}-${idx}`}
          att={att}
        />
      ))}
    </div>
  );
}

function ContextPreviews() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-2 pt-2">
      {attachments.files.map((file) => {
        const isImage = file.mediaType?.startsWith("image/");
        const fileName = file.filename ?? "archivo";
        return (
          <div key={file.id} className="relative group/img">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={file.url}
                alt={fileName}
                className="size-14 rounded-lg object-cover border border-border ring-1 ring-border/50"
              />
            ) : (
              <div className="size-14 rounded-lg border border-border bg-muted/60 flex flex-col items-center justify-center gap-1 px-1">
                <FileText className="size-4 text-muted-foreground" />
                <span className="text-[9px] uppercase font-mono text-muted-foreground truncate w-full text-center">
                  {(fileName.split(".").pop() ?? "doc").slice(0, 5)}
                </span>
              </div>
            )}
            <button
              id={`btn-remove-attachment-${file.id}`}
              type="button"
              onClick={() => attachments.remove(file.id)}
              aria-label={`Quitar ${fileName}`}
              className="absolute cursor-pointer -top-1.5 -right-1.5 size-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity shadow-sm"
            >
              <X size={9} />
            </button>
            <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/60 px-1 py-0.5 opacity-0 group-hover/img:opacity-100 transition-opacity">
              <p className="truncate text-[10px] text-white">{fileName}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface AttachedImagePreviewsProps {
  attachments?: ChatAttachment[];
  align?: "start" | "end";
  className?: string;
}

export default function AttachedImagePreviews(props: AttachedImagePreviewsProps) {
  if (props.attachments) {
    return (
      <StaticPreviews
        attachments={props.attachments}
        align={props.align}
        className={props.className}
      />
    );
  }
  return <ContextPreviews />;
}
