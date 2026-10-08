export interface InstantaneaPlanificador {
  id: string;
  nombre: string;
  activa: boolean;

  proximaEjecucion: string | null;
  enEjecucion: boolean;
}

interface ApiEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

export async function getJobScheduler(): Promise<
  ApiEnvelope<InstantaneaPlanificador[]>
> {
  try {
    const res = await fetch("/api/jobs/scheduler", {
      credentials: "include",
      cache: "no-store",
    });
    const cuerpo = (await res.json()) as ApiEnvelope<InstantaneaPlanificador[]>;
    if (!cuerpo?.success || !Array.isArray(cuerpo.data)) {
      return {
        success: false,
        message: cuerpo?.message || "No se pudo leer el estado del planificador.",
      };
    }
    return { success: true, message: cuerpo.message ?? "", data: cuerpo.data };
  } catch {
    return {
      success: false,
      message: "No se pudo leer el estado del planificador.",
    };
  }
}
