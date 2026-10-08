"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import LoginForm from "@/component/auth/LoginForm";
import RegisterForm from "@/component/auth/RegisterForm";

type AuthMode = "login" | "register";

const TABS: { value: AuthMode; label: string }[] = [
  { value: "login", label: "Iniciar Sesión" },
  { value: "register", label: "Registrarse" },
];

export default function AuthPage() {
  const [mode, setMode] = useState<AuthMode>("login");

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl shadow-cyan-500/5 backdrop-blur-sm p-6 sm:p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
            <Activity className="h-6 w-6 text-cyan-400" />
          </div>
          <h1 className="text-xl font-bold tracking-wider text-slate-100">
            PACKET TOOLS
          </h1>
          <p className="text-sm text-slate-400">
            Gestión inteligente de redes
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Autenticación"
          className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={mode === tab.value}
              onClick={() => setMode(tab.value)}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200",
                mode === tab.value
                  ? "bg-cyan-500/15 text-cyan-300 shadow-sm shadow-cyan-500/10"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === "login" ? (
          <LoginForm onSwitchToRegister={() => setMode("register")} />
        ) : (
          <RegisterForm onSuccess={() => setMode("login")} />
        )}
      </div>
    </div>
  );
}
