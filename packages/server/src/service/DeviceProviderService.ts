import {
  Prisma,
  TypeDevice,
  ConnectionProtocol,
} from "@/prisma/generated/client";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";

class DeviceProviderService {
  async getAllTypesDevices() {
    return TypeDevice;
  }

  async getAllProtocols() {
    return ConnectionProtocol;
  }

  async getAll() {
    try {
      const devices = await prismaClient.deviceProviders.findMany({
        include: { topology: true },
        orderBy: { updatedAt: "desc" },
      });
      return {
        success: true,
        message: "Dispositivos obtenidos",
        data: devices,
      };
    } catch (error) {
      Logger.error({
        message: `[DEVICE_PROVIDER_SERVICE] Error consultando dispositivos`,
        data: error,
      });
      return {
        success: false,
        message: "Error al consultar los dispositivos",
        data: null,
      };
    }
  }

  async getById(id: string) {
    try {
      const device = await prismaClient.deviceProviders.findUnique({
        where: { id },
        include: { topology: true },
      });
      return { success: true, message: "Dispositivo encontrado", data: device };
    } catch (error) {
      Logger.error({
        message: `[DEVICE_PROVIDER_SERVICE] Error consultando dispositivo`,
        data: error,
      });
      return {
        success: false,
        message: "Error al consultar el dispositivo",
        data: null,
      };
    }
  }

  async create(data: Prisma.DeviceProvidersUncheckedCreateInput) {
    try {
      const device = await prismaClient.deviceProviders.create({ data });

      Logger.info({
        message: `[DEVICE_PROVIDER_SERVICE] Dispositivo registrado`,
        data: {
          id: device.id,
          name: device.name,
          type: device.typeDevice,
          date: device.createdAt,
        },
      });

      return {
        success: true,
        message: "Dispositivo creado exitosamente",
        data: device,
      };
    } catch (error) {
      Logger.error({
        message: `[DEVICE_PROVIDER_SERVICE] Error creando dispositivo`,
        data: error,
      });
      return {
        success: false,
        message: "Error al crear el dispositivo",
        data: null,
      };
    }
  }

  async update(id: string, data: Prisma.DeviceProvidersUncheckedUpdateInput) {
    try {
      const device = await prismaClient.deviceProviders.update({
        where: { id },
        data,
      });

      Logger.info({
        message: `[DEVICE_PROVIDER_SERVICE] Dispositivo actualizado`,
        data: {
          id: device.id,
          name: device.name,
          type: device.typeDevice,
          date: device.updatedAt,
        },
      });

      return {
        success: true,
        message: "Dispositivo actualizado exitosamente",
        data: device,
      };
    } catch (error) {
      Logger.error({
        message: `[DEVICE_PROVIDER_SERVICE] Error actualizando dispositivo`,
        data: error,
      });
      return {
        success: false,
        message: "Error al actualizar el dispositivo",
        data: null,
      };
    }
  }

  async delete(id: string) {
    try {
      const device = await prismaClient.deviceProviders.delete({
        where: { id },
      });
      return {
        success: true,
        message: "Dispositivo eliminado exitosamente",
        data: device,
      };
    } catch (error) {
      Logger.error({
        message: `[DEVICE_PROVIDER_SERVICE] Error eliminando dispositivo`,
        data: error,
      });
      return {
        success: false,
        message: "Error al eliminar el dispositivo",
        data: null,
      };
    }
  }
}

export const deviceProviderService = new DeviceProviderService();
