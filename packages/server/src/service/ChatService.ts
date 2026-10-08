import { prismaClient } from "@/prisma/lib/PrismaClient";

class ChatService {

  async getAll(userId: string) {
    try {
      const chats = await prismaClient.chat.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
      return { succes: true, message: "Chats obtenidos exitosamente", data: chats };
    } catch (error) {
      console.error("Error al obtener los chats:", error);
      return { succes: false, message: "Error al obtener chats", data: null };
    }
  }

  async getById(id: string) {
    try {
      const chat = await prismaClient.chat.findUnique({
        where: { id },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
        },
      });
      return { succes: true, message: "Chat obtenido exitosamente", data: chat };
    } catch (error) {
      console.error("Error al obtener el chat:", error);
      return { succes: false, message: "Error al obtener chat", data: null };
    }
  }

  async getMessages(chatId: string, page: number = 1, pageSize: number = 50) {
    try {
      const skip = (page - 1) * pageSize;

      const [messages, total] = await prismaClient.$transaction([
        prismaClient.message.findMany({
          where: { chatId },
          orderBy: { createdAt: "asc" },
          skip,
          take: pageSize,
        }),
        prismaClient.message.count({
          where: { chatId },
        }),
      ]);

      return {
        succes: true,
        message: "Mensajes obtenidos exitosamente",
        data: {
          messages,
          pagination: {
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
            hasMore: skip + messages.length < total,
          },
        },
      };
    } catch (error) {
      console.error("Error al obtener mensajes:", error);
      return { succes: false, message: "Error al obtener mensajes", data: null };
    }
  }

  async getOrCreateActiveChat(userId: string) {
    try {
      let chat = await prismaClient.chat.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!chat) {
        chat = await prismaClient.chat.create({
          data: {
            userId,
            title: "Nueva conversación",
          },
          include: { messages: true },
        });
      }

      return { succes: true, message: "Chat activo obtenido exitosamente", data: chat };
    } catch (error) {
      console.error("Error al obtener o crear chat activo:", error);
      return { succes: false, message: "Error al obtener chat activo", data: null };
    }
  }

  async createChat(userId: string, title?: string) {
    try {
      const chat = await prismaClient.chat.create({
        data: {
          userId,
          title: title || "Nueva conversación",
        },
      });
      return { succes: true, message: "Chat creado exitosamente", data: chat };
    } catch (error) {
      console.error("Error al crear el chat:", error);
      return { succes: false, message: "Error al crear chat", data: null };
    }
  }

  async addMessage(
    chatId: string,
    role: "user" | "assistant" | "system",
    content: string
  ) {
    try {
      const [message] = await prismaClient.$transaction([
        prismaClient.message.create({
          data: { chatId, role, content },
        }),
        prismaClient.chat.update({
          where: { id: chatId },
          data: { updatedAt: new Date() },
        }),
      ]);

      return { succes: true, message: "Mensaje agregado exitosamente", data: message };
    } catch (error) {
      console.error("Error al agregar mensaje:", error);
      return { succes: false, message: "Error al agregar mensaje", data: null };
    }
  }

  async updateTitle(chatId: string, title: string) {
    try {
      const chat = await prismaClient.chat.update({
        where: { id: chatId },
        data: { title },
      });
      return { succes: true, message: "Título actualizado exitosamente", data: chat };
    } catch (error) {
      console.error("Error al actualizar título:", error);
      return { succes: false, message: "Error al actualizar título", data: null };
    }
  }

  async delete(id: string) {
    try {
      const chat = await prismaClient.chat.delete({ where: { id } });
      return { succes: true, message: "Chat eliminado exitosamente", data: chat };
    } catch (error) {
      console.error("Error al eliminar el chat:", error);
      return { succes: false, message: "Error al eliminar chat", data: null };
    }
  }

  async clearAllUserChats(userId: string) {
    try {
      const { count } = await prismaClient.chat.deleteMany({
        where: { userId },
      });
      return {
        succes: true,
        message: `${count} chats eliminados exitosamente`,
        data: { deletedCount: count },
      };
    } catch (error) {
      console.error("Error al limpiar historial:", error);
      return { succes: false, message: "Error al limpiar historial", data: null };
    }
  }
}

export const chatService = new ChatService();
