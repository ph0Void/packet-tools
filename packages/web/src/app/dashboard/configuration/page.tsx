import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import { getConfig } from "@/service/ConfigService";
import SystemPromptCard from "@/component/configuration/SystemPromptCard";
import ModelProvidersManager from "@/component/configuration/ModelProvidersManager";
import AgentLogsCard from "@/component/configuration/AgentLogsCard";
import { Settings } from "lucide-react";

export const metadata = {
  title: "Packet Tools - Configuración del Sistema",
  description: "Prompt del sistema y gestión de proveedores de modelos IA",
};

export default async function PageConfig() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") redirect("/dashboard");

  const result = await getConfig();
  const initialPrompt =
    result.success && result.data ? (result.data.systemPrompt ?? "") : "";

  const agentLogsEnabled = result.data?.agentLogsEnabled ?? true;

  return (
    <div className="space-y-6 text-foreground p-1">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/40 bg-muted/30 p-4 md:p-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Settings className="h-5 w-5 text-primary" />
            Configuración
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Prompt del sistema y gestión de proveedores de modelos IA
          </p>
        </div>
      </div>

      <AgentLogsCard initialEnabled={agentLogsEnabled} />
      <ModelProvidersManager />
      <SystemPromptCard initialPrompt={initialPrompt} />
    </div>
  );
}
