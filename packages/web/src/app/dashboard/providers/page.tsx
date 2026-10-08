import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import ModelProvidersManager from "@/component/configuration/ModelProvidersManager";

export const metadata = {
  title: "Packet Tools - Proveedores de Modelos LLM",
  description: "Gestión CRUD de proveedores de modelos de IA",
};

export default async function PageProviders() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") redirect("/dashboard");

  return (
    <div className="space-y-6 text-foreground p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Proveedores de Modelos LLM
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Administra los modelos cloud y locales disponibles para el agente de red.
        </p>
      </div>

      <ModelProvidersManager />
    </div>
  );
}
