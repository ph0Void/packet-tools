import { Prisma } from "@/prisma/generated/client";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";

class KnowledgeBaseService {
  async getAll() {
    try {
      const items = await prismaClient.knowledgeBase.findMany({
        include: { createdBy: { select: { username: true } } },
        orderBy: { updatedAt: "desc" },
      });
      return {
        success: true,
        message: "Documentos RAG obtenidos",
        data: items,
      };
    } catch (error) {
      Logger.error({
        message: `[KNOWLEDGE_BASE_SERVICE] Error consultando documentos`,
        data: error,
      });
      return {
        success: false,
        message: "Error al obtener documentos",
        data: null,
      };
    }
  }

  async getById(id: string) {
    try {
      const item = await prismaClient.knowledgeBase.findUnique({
        where: { id },
        include: { createdBy: true },
      });
      return { success: true, message: "Documento obtenido", data: item };
    } catch (error) {
      Logger.error({
        message: `[KNOWLEDGE_BASE_SERVICE] Error consultando documento`,
        data: error,
      });
      return {
        success: false,
        message: "Error al consultar documento",
        data: null,
      };
    }
  }

  async create(data: Prisma.KnowledgeBaseUncheckedCreateInput) {
    try {
      const item = await prismaClient.knowledgeBase.create({ data });
      return {
        success: true,
        message: "Documento agregado exitosamente",
        data: item,
      };
    } catch (error) {
      Logger.error({
        message: `[KNOWLEDGE_BASE_SERVICE] Error creando documento`,
        data: error,
      });
      return {
        success: false,
        message: "Error al guardar el documento",
        data: null,
      };
    }
  }

  async update(id: string, data: Prisma.KnowledgeBaseUncheckedUpdateInput) {
    try {
      const item = await prismaClient.knowledgeBase.update({
        where: { id },
        data,
      });

      return {
        success: true,
        message: "Documento actualizado exitosamente",
        data: item,
      };
    } catch (error) {
      Logger.error({
        message: `[KNOWLEDGE_BASE_SERVICE] Error actualizando documento`,
        data: error,
      });
      return {
        success: false,
        message: "Error al actualizar documento",
        data: null,
      };
    }
  }

  async delete(id: string) {
    try {
      const item = await prismaClient.knowledgeBase.delete({ where: { id } });

      Logger.info({
        message: `[KNOWLEDGE_BASE_SERVICE] Documento eliminado`,
        data: {
          id: item.id,
          title: item.title,
          date: item.updatedAt,
        },
      });

      return {
        success: true,
        message: "Documento eliminado exitosamente",
        data: item,
      };
    } catch (error) {
      Logger.error({
        message: `[KNOWLEDGE_BASE_SERVICE] Error eliminando documento`,
        data: error,
      });
      return {
        success: false,
        message: "Error al eliminar documento",
        data: null,
      };
    }
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
