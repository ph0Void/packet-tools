import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acceso | Packet Tools",
  description: "Inicia sesión o regístrate para acceder a Packet Tools.",
};

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="dark min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      {children}
    </div>
  );
}
