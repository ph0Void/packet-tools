"use client";

import React, { useActionState, useEffect, useState } from "react";import { useRouter } from "next/navigation";
import { Loader2, MessageSquareCode, Save } from "lucide-react";
import { toast } from "sonner";
import { updateSystemPromptAction } from "@/action/ConfigAction";
import type { FormState } from "@/types/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: FormState = { success: false, message: "" };

interface SystemPromptCardProps {
  initialPrompt: string | null | undefined;
}

export default function SystemPromptCard({
  initialPrompt,
}: SystemPromptCardProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    updateSystemPromptAction,
    initialState,
  );
  const [prompt, setPrompt] = useState(initialPrompt ?? "");

  const [lastInitialPrompt, setLastInitialPrompt] = useState(initialPrompt);
  if (lastInitialPrompt !== initialPrompt) {
    setLastInitialPrompt(initialPrompt);
    setPrompt(initialPrompt ?? "");
  }

  useEffect(() => {
    if (isPending || !state.message) return;
    if (state.success) {
      toast.success(state.message);
      router.refresh();
    } else {
      toast.error(state.message);
    }
  }, [state, isPending, router]);

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-6 shadow-sm space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
          <MessageSquareCode className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-bold tracking-tight">
            Prompt del Sistema
          </h2>
          <p className="text-xs text-muted-foreground">
            Instrucciones globales que recibe el agente de red en cada sesión.
          </p>
        </div>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="system-prompt">Contenido del prompt</Label>
          <Textarea
            id="system-prompt"
            name="systemPrompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={12}
            required
            aria-invalid={!state.success && Boolean(state.message)}
            className="font-mono text-sm min-h-56 resize-y"
            placeholder="Eres un asistente experto en redes..."
          />
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Se aplica a los agentes de chat, terminales y topologías.
          </p>
          <Button type="submit" disabled={isPending} className="gap-2">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Guardando...
              </>
            ) : (
              <>
                <Save className="w-4 h-4" /> Guardar Prompt
              </>
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}
