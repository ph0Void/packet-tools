"use server";

import { revalidatePath } from "next/cache";
import {
  deleteTopology,
  getTopology,
  getTopologies,
  saveTopology,
  type Topology,
} from "@/service/TopologyService";
import type { FormState } from "@/types/actions";

export type FormTopologyState = FormState<Topology | null>;

export type FormTopologyListState = FormState<Topology[]> & {
  page: number;
  limit: number;
  total: number;
};

export async function saveTopologyAction(
  name: string,
  description: string,
  topologyJson: string,
  id?: string,
): Promise<FormTopologyState> {
  try {
    if (!name?.trim()) {
      return { success: false, message: "El nombre de la topología es obligatorio." };
    }

    const result = await saveTopology({
      ...(id ? { id } : {}),
      name: name.trim(),
      description: description ?? null,
      topologyJson,
    });

    if (!result.success) {
      return { success: false, message: result.message };
    }

    revalidatePath("/dashboard/topology");
    return {
      success: true,
      message: result.message || "Topología guardada correctamente.",
      data: result.data,
    };
  } catch (error) {
    console.error("Error al guardar la topología:", error);
    return {
      success: false,
      message: "Error al procesar la solicitud en el servidor.",
    };
  }
}

export async function getAllTopologiesAction(
  page: number = 1,
  limit: number = 10,
): Promise<FormTopologyListState> {
  try {
    const result = await getTopologies();

    if (!result.success || !result.data) {
      return {
        success: false,
        message: result.message || "No autorizado.",
        data: [],
        page,
        limit,
        total: 0,
      };
    }

    const start = (page - 1) * limit;

    return {
      success: true,
      message: result.message,
      data: result.data.slice(start, start + limit),
      page,
      limit,
      total: result.data.length,
    };
  } catch (error) {
    console.error("Error al obtener las topologías:", error);
    return {
      success: false,
      message: "Error al obtener topologías.",
      data: [],
      page,
      limit,
      total: 0,
    };
  }
}

export async function getTopologyByIdAction(
  id: string,
): Promise<FormTopologyState> {
  try {
    const result = await getTopology(id);

    if (!result.success) {
      return {
        success: false,
        message: result.message,
        data: null,
      };
    }

    return {
      success: true,
      message: result.message,
      data: result.data,
    };
  } catch (error) {
    console.error("Error al obtener topología:", error);
    return {
      success: false,
      message: "Error al obtener la topología.",
      data: null,
    };
  }
}

export async function deleteTopologyAction(
  id: string,
): Promise<FormTopologyState> {
  try {
    const result = await deleteTopology(id);

    if (!result.success) {
      return { success: false, message: result.message };
    }

    revalidatePath("/dashboard/topology");
    return { success: true, message: result.message || "Topología eliminada." };
  } catch (error) {
    console.error("Error al eliminar topología:", error);
    return {
      success: false,
      message: "Error al eliminar la topología.",
    };
  }
}
