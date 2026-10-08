import { getModelTextProvider } from "@/config/ModelProviderConfig";
import { configService } from "@/service/ConfigService";
import { envConfig } from "@/config/EnvConfig";

export async function buildSystemPrompt(
  basePrompt: string,
  opciones: { conHerramientasTerminal?: boolean } = {},
): Promise<string> {
  const globalPrompt = await configService.getGlobalSystemPrompt();
  const promptBase = globalPrompt
    ? `${basePrompt}\n\n## Instrucciones globales del sistema\n${globalPrompt}`
    : basePrompt;
  return promptBase;
}

export async function getModelProvider(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  const { model } = await resolveModelProvider(modelProviderId, role);
  return model;
}

export async function getModelProviderWithMeta(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  return resolveModelProvider(modelProviderId, role);
}

async function resolveModelProvider(
  modelProviderId?: string,
  role: string = "ADMIN",
) {
  const provider = await configService.findModelProviderById(
    modelProviderId,
    role,
  );

  if (!provider) {
    throw new Error(
      "No hay ningún proveedor de IA activo configurado. Ve a /dashboard/configuration y crea uno.",
    );
  }
  if (!provider.modelName?.trim()) {
    throw new Error(
      `El proveedor "${provider.name}" no tiene modelName configurado.`,
    );
  }

  const providerUpper = (provider.provider ?? "").toUpperCase();
  const isLocalCustom =
    providerUpper === "CUSTOM" &&
    provider.baseUrl != null &&
    (provider.baseUrl.includes("localhost") || provider.baseUrl.includes("127.0.0.1"));
  const mustHaveKey =
    ["OPENAI", "OPENROUTER", "ANTHROPIC", "GOOGLE"].includes(providerUpper) ||
    (providerUpper === "CUSTOM" && !isLocalCustom);

  if (mustHaveKey && !provider.apiKey?.trim()) {
    throw new Error(
      `API Key faltante para el proveedor "${provider.name}" (${provider.provider}). Configúrala en /dashboard/configuration.`,
    );
  }

  const model = getModelTextProvider({
    provider: provider.provider!,
    model: provider.modelName!,
    apiKey: provider.apiKey ?? "",
    baseUrl: provider.baseUrl!,
    temperature: provider.temperature ?? 0.7,

    maxOutputTokens: envConfig.AGENT_MAX_OUTPUT_TOKENS,
  });

  return { model, provider: providerUpper };
}
