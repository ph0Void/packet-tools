import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  resolveVendorProfile,
  type VendorProfile,
} from "@/agent/security/VendorProfile";
import { requestContext } from "@/utils/RequestContext";

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  typeDevice: string | null;
  expira: number;
}

const cachePorProvider = new Map<string, CacheEntry>();

export function resetVendorCache(): void {
  cachePorProvider.clear();
}

export async function typeDeviceDeProvider(
  providerId?: string | null,
): Promise<string | null> {
  const id = String(providerId ?? "").trim();
  if (!id) return null;

  const cached = cachePorProvider.get(id);
  if (cached && cached.expira > Date.now()) return cached.typeDevice;

  try {
    const device = await prismaClient.deviceProviders.findUnique({
      where: { id },
      select: { typeDevice: true },
    });
    const typeDevice = device?.typeDevice ?? null;
    cachePorProvider.set(id, { typeDevice, expira: Date.now() + CACHE_TTL_MS });
    return typeDevice;
  } catch {

    return null;
  }
}

export async function resolveVendorForConsole(params: {
  providerId?: string | null;
  prompt?: string | null;
}): Promise<VendorProfile> {
  const typeDevice = await typeDeviceDeProvider(params.providerId);
  return resolveVendorProfile({ typeDevice, prompt: params.prompt });
}

export async function resolveTurnVendor(params: {
  providerId?: string | null;
  prompt?: string | null;
} = {}): Promise<VendorProfile> {
  const ctx = requestContext.getStore();
  return resolveVendorForConsole({
    providerId: params.providerId ?? ctx?.connectionProviderId ?? null,
    prompt: params.prompt ?? null,
  });
}
