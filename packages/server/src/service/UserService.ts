import { prismaClient } from "@/prisma/lib/PrismaClient";
import { BcryptAdapter } from "@/utils/BcryptAdapter";
import { Logger } from "@/utils/Logger";

class UserService {
  async register(username: string, password: string, role: string = "USER") {
    try {
      const hashedPassword = BcryptAdapter.hash(password);
      const user = await prismaClient.user.create({
        data: {
          username,
          password: hashedPassword,
          role: role as any,
        },
      });
      return {
        success: true,
        message: "Usuario registrado exitosamente",
        data: user,
      };
    } catch (error) {
      Logger.error({
        message: `[USER_SERVICE] Error registrando usuario ${username}`,
        data: error,
      });
      return {
        success: false,
        message: "Error al registrar usuario",
        data: null,
      };
    }
  }

  async update(id: string, username: string, password: string, role: string) {
    try {
      const hashedPassword = BcryptAdapter.hash(password);
      const user = await prismaClient.user.update({
        where: {
          id,
        },
        data: {
          username,
          password: hashedPassword,
          role: role as any,
        },
      });
      return {
        success: true,
        message: "Usuario actualizado exitosamente",
        data: user,
      };
    } catch (error) {
      Logger.error({
        message: `[USER_SERVICE] Error actualizando usuario ${username}`,
        data: error,
      });

      return {
        success: false,
        message: "Error al actualizar usuario",
        data: null,
      };
    }
  }

  async delete(id: string) {
    try {
      const user = await prismaClient.user.delete({
        where: {
          id,
        },
      });
      return {
        success: true,
        message: "Usuario eliminado exitosamente",
        data: user,
      };
    } catch (error) {
      Logger.error({
        message: `[USER_SERVICE] Error eliminando usuario ${id}`,
        data: error,
      });
      return {
        success: false,
        message: "Error al eliminar usuario",
        data: null,
      };
    }
  }

  async getAll(page: number, limit: number) {
    try {
      const user = await prismaClient.user.findMany({
        skip: (page - 1) * limit,
        take: limit,
      });
      return {
        success: true,
        message: "Usuarios obtenidos exitosamente",
        data: user,
      };
    } catch (error) {
      Logger.error({
        message: `[USER_SERVICE] Error obteniendo usuarios`,
        data: error,
      });
      return {
        success: false,
        message: "Error al obtener usuarios",
        data: null,
      };
    }
  }

  async getById(id: string) {
    try {
      const user = await prismaClient.user.findUnique({
        where: {
          id,
        },
      });
      return {
        success: true,
        message: "Usuario obtenido exitosamente",
        data: user,
      };
    } catch (error) {
      Logger.error({
        message: `[USER_SERVICE] Error obteniendo usuario ${id}`,
        data: error,
      });
      return {
        success: false,
        message: "Error al obtener usuario",
        data: null,
      };
    }
  }
}

export const userService = new UserService();
