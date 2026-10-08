"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { loginAction, type FormState } from "@/action/AuthAction";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const initialState: FormState = {
  success: false,
  message: "",
};

interface LoginFormProps {
  onSwitchToRegister?: () => void;
}

export default function LoginForm({ onSwitchToRegister }: LoginFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state.success) {
      toast.success(state.message || "Inicio de sesión exitoso");
      router.push("/dashboard");
      router.refresh();
      return;
    }
    if (!isPending && state.message) {
      toast.error(state.message);
    }
  }, [state.success, state.message, isPending, router]);

  return (
    <form action={formAction} className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="login-username"
          className="text-xs font-semibold uppercase tracking-wider text-slate-400"
        >
          Usuario
        </label>
        <div className="relative group">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-cyan-400" />
          <Input
            id="login-username"
            name="username"
            type="text"
            required
            autoComplete="username"
            placeholder="Introduce tu usuario"
            aria-invalid={!state.success && Boolean(state.message)}
            className="h-11 rounded-xl border-slate-800 bg-slate-950/60 pl-9 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:border-cyan-500/60 focus-visible:ring-cyan-500/20"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="login-password"
          className="text-xs font-semibold uppercase tracking-wider text-slate-400"
        >
          Contraseña
        </label>
        <div className="relative group">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-cyan-400" />
          <Input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            aria-invalid={!state.success && Boolean(state.message)}
            className="h-11 rounded-xl border-slate-800 bg-slate-950/60 pl-9 pr-10 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:border-cyan-500/60 focus-visible:ring-cyan-500/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={
              showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
            }
            className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-slate-500 transition-colors hover:text-slate-300"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <Button
        type="submit"
        disabled={isPending}
        size="lg"
        className="mt-1 w-full cursor-pointer rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-500/10 transition-all duration-200 hover:from-cyan-500 hover:to-blue-500 hover:shadow-cyan-500/20 active:scale-[0.98]"
      >
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando credenciales...
          </>
        ) : (
          <>
            Iniciar Sesión
            <LogIn className="h-4 w-4" />
          </>
        )}
      </Button>

      {state.message && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-xl border p-3.5 text-sm animate-in fade-in slide-in-from-top-1 duration-200 ${
            state.success
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
              : "border-rose-500/20 bg-rose-500/10 text-rose-400"
          }`}
        >
          {state.success ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          )}
          <span>{state.message}</span>
        </div>
      )}

      {onSwitchToRegister && (
        <p className="text-center text-xs text-slate-500">
          ¿No tienes cuenta?{" "}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="cursor-pointer font-semibold text-cyan-400 transition-colors hover:text-cyan-300"
          >
            Regístrate
          </button>
        </p>
      )}
    </form>
  );
}
