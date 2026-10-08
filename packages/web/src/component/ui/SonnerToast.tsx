"use client";
import type { CSSProperties } from "react";
import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { Toaster } from "sonner";

const ESTILO_TOASTER = {
  "--border-radius": "10px",
  "--normal-bg": "var(--popover)",
  "--normal-border": "var(--border)",
  "--normal-text": "var(--popover-foreground)",
  "--width": "380px",
} as CSSProperties;

export default function SonnerToast() {
  return (
    <Toaster
      position="bottom-right"
      closeButton
      duration={6000}
      gap={8}
      toastOptions={{

        duration: 6000,
        classNames: {
          toast:
            "max-w-[380px] rounded-[10px] border border-border bg-popover px-3 py-2.5 text-[13px] leading-[1.55] shadow-lg",
          title: "text-[13px] leading-[1.55] font-medium",
          description: "text-[13px] leading-[1.55] text-muted-foreground",
          icon: "shrink-0",
        },
      }}
      style={ESTILO_TOASTER}
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        info: <Info className="size-4 text-info" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        error: <CircleAlert className="size-4 text-critical" />,
        loading: (
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        ),
      }}
    />
  );
}
