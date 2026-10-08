"use client";

import { MessageResponse } from "@/components/ai-elements/message";
import { Copy, Check } from "lucide-react";

interface ParsedContentProps {
  text: string;
  msgId?: string;
  onCopy: (text: string) => void;
  copied: boolean;
}

export function ParsedContentComponent({
  text,
  onCopy,
  copied,
}: ParsedContentProps) {
  return (
    <div className="relative group/content">
      <button
        onClick={() => onCopy(text)}
        title="Copiar respuesta"
        className="absolute top-1 right-1 opacity-0 group-hover/content:opacity-100 transition-all flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white z-10 shadow-sm"
      >
        {copied ? (
          <>
            <Check size={12} className="text-slate-700 dark:text-slate-200" />
            <span>Copiado</span>
          </>
        ) : (
          <>
            <Copy size={12} />
            <span>Copiar</span>
          </>
        )}
      </button>

      <div className="prose-cisco">
        <MessageResponse>{text}</MessageResponse>
      </div>
    </div>
  );
}
