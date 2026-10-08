import { Router } from "express";
import { z } from "zod";
import { Role } from "@/prisma/generated/enums";
import { Gns3Client } from "@/client/Gns3Client";
import { SerialPortClient } from "@/client/SerialPortClient";
import { SshClient } from "@/client/SshClient";
import { TelnetClient } from "@/client/TelnetClient";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { simulationBridge } from "@/sockets/SimulationBridge";
import {
  buildTerminalFingerprint,
  terminalSessionHub,
} from "@/sockets/TerminalSessionHub";
import { resourceRouter } from "./ResourceRouter";

const router = Router();

const MASKED_PASSWORD = "[configured]";

const SUPPORTED_TYPES = new Set([
  "GNS3",
  "PACKET_TRACER",
  "CISCO",
  "HUAWEI",
  "ARUBA",
  "MIKROTIK",
  "GENERIC",
]);

const DEFAULT_PORTS: Record<string, number> = { SSH: 22, TELNET: 23 };
const DEFAULT_SERIAL_BAUDRATE = 9600;
const SSH_TIMEOUT_MS = 10_000;
const TELNET_TIMEOUT_MS = 8_000;
const SERIAL_TIMEOUT_MS = 8_000;

const testInput = z.object({
  providerId: z.string().optional(),
  typeDevice: z.string().optional(),
  protocol: z.string().optional(),
  host: z.string().optional(),
  port: z.number().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  serialPort: z.string().optional(),
  serialBaudrate: z.number().optional(),
});

interface ProviderRow {
  id: string;
  typeDevice: string;
  protocol: string;
  host: string | null;
  port: number | null;
  serialPort: string | null;
  serialBaudrate: number | null;
  username: string | null;
  password: string | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Tiempo de espera agotado (${ms} ms)`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "error desconocido";
}

function isValidPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

function normalizeBaudrate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

router.post(
  "/test",
  authMiddleware,
  requireRoles(Role.ADMIN, Role.STAFF),
  async (req, res, next) => {
    try {
      const body = testInput.parse(req.body ?? {});
      const providerId = body.providerId?.trim();

      let provider: ProviderRow | null = null;

      if (providerId) {
        provider = await prismaClient.deviceProviders.findUnique({
          where: { id: providerId },
        });
        if (!provider) {
          return res.status(404).json({
            success: false,
            message: "No se encontró el dispositivo indicado.",
            data: null,
          });
        }
      }

      const typeDevice = (
        body.typeDevice?.trim() ||
        provider?.typeDevice ||
        ""
      ).toUpperCase();
      if (!SUPPORTED_TYPES.has(typeDevice)) {
        return res.status(400).json({
          success: false,
          message: `Tipo de dispositivo no soportado para prueba de conexión: ${typeDevice}`,
          data: null,
        });
      }

      const protocol = (
        body.protocol?.trim() ||
        provider?.protocol ||
        ""
      ).toUpperCase();
      const host = body.host?.trim() || provider?.host?.trim() || "";
      const username = body.username?.trim() || provider?.username?.trim() || null;
      const password =
        body.password && body.password !== MASKED_PASSWORD
          ? body.password
          : (provider?.password ?? null);

      if (typeDevice === "GNS3") {
        if (!host) {
          return res.status(400).json({
            success: false,
            message: "Falta el host del servidor GNS3.",
            data: null,
          });
        }

        const client = new Gns3Client(host, username, password);
        const startedAt = Date.now();
        const result = await client.testConnection();
        const latencyMs = Date.now() - startedAt;

        const message = result.ok
          ? `Conexión GNS3 correcta (versión ${result.version ?? "desconocida"}).`
          : result.status === 401
            ? "Credenciales GNS3 inválidas (401). Revisa usuario y contraseña."
            : `No se pudo conectar con GNS3: ${result.error ?? "error desconocido"}`;

        return res.json({
          success: result.ok,
          message,
          data: {
            typeDevice,
            protocol,
            status: result.status ?? null,
            version: result.version ?? null,
            latencyMs,
          },
        });
      }

      if (typeDevice === "PACKET_TRACER") {
        const connected = simulationBridge.isPacketTracerConnected;
        return res.json({
          success: connected,
          message: connected
            ? "Extensión de Packet Tracer conectada y lista."
            : "No hay ninguna extensión Packet Tracer conectada al backend. Abre Packet Tracer con la extensión activa e inténtalo de nuevo.",
          data: {
            typeDevice,
            protocol,
            status: null,
            version: null,
            latencyMs: null,
          },
        });
      }

      const rawPort = body.port ?? provider?.port ?? null;

      if (protocol === "SSH") {
        if (!host) {
          return res.status(400).json({
            success: false,
            message: "Falta el host para la conexión SSH.",
            data: null,
          });
        }
        if (rawPort !== null && !isValidPort(rawPort)) {
          return res.status(400).json({
            success: false,
            message:
              "El puerto SSH no es válido: debe ser un número entre 1 y 65535.",
            data: null,
          });
        }

        const port = rawPort ?? DEFAULT_PORTS.SSH;
        const client = new SshClient(
          host,
          port,
          username ?? "admin",
          password ?? undefined,
        );
        const startedAt = Date.now();

        try {
          await withTimeout(client.connect(), SSH_TIMEOUT_MS);
          const latencyMs = Date.now() - startedAt;
          return res.json({
            success: true,
            message: `Conexión SSH correcta a ${host}:${port} (${latencyMs} ms).`,
            data: {
              typeDevice,
              protocol,
              status: null,
              version: null,
              latencyMs,
            },
          });
        } catch (error) {
          const latencyMs = Date.now() - startedAt;
          return res.json({
            success: false,
            message: `No se pudo conectar por SSH a ${host}:${port}: ${errorDetail(error)}`,
            data: {
              typeDevice,
              protocol,
              status: null,
              version: null,
              latencyMs,
            },
          });
        } finally {
          await client.disconnect().catch(() => undefined);
        }
      }

      if (protocol === "TELNET") {
        if (!host) {
          return res.status(400).json({
            success: false,
            message: "Falta el host para la conexión Telnet.",
            data: null,
          });
        }
        if (rawPort !== null && !isValidPort(rawPort)) {
          return res.status(400).json({
            success: false,
            message:
              "El puerto Telnet no es válido: debe ser un número entre 1 y 65535.",
            data: null,
          });
        }

        const port = rawPort ?? DEFAULT_PORTS.TELNET;
        const client = new TelnetClient(
          host,
          port,
          username ?? undefined,
          password ?? undefined,
        );
        const startedAt = Date.now();

        try {
          await withTimeout(client.connect(), TELNET_TIMEOUT_MS);
          const latencyMs = Date.now() - startedAt;
          return res.json({
            success: true,
            message: `Conexión Telnet correcta a ${host}:${port} (${latencyMs} ms).`,
            data: {
              typeDevice,
              protocol,
              status: null,
              version: null,
              latencyMs,
            },
          });
        } catch (error) {
          const latencyMs = Date.now() - startedAt;
          const detalle = errorDetail(error).replace(
            `Error Telnet (${host}:${port}): `,
            "",
          );
          return res.json({
            success: false,
            message: `No se pudo conectar por Telnet a ${host}:${port}: ${detalle}`,
            data: {
              typeDevice,
              protocol,
              status: null,
              version: null,
              latencyMs,
            },
          });
        } finally {
          await client.disconnect().catch(() => undefined);
        }
      }

      if (protocol === "SERIAL") {
        const serialPort =
          body.serialPort?.trim() || provider?.serialPort?.trim() || "";
        if (!serialPort) {
          return res.status(400).json({
            success: false,
            message: "Falta el puerto serial del dispositivo.",
            data: null,
          });
        }

        const baudrate =
          normalizeBaudrate(body.serialBaudrate) ??
          normalizeBaudrate(provider?.serialBaudrate) ??
          DEFAULT_SERIAL_BAUDRATE;

        const activeSession = terminalSessionHub.findMatch(
          req.user?.id ?? "",
          provider?.id ?? null,
          buildTerminalFingerprint({
            protocol: "SERIAL",
            serialPort,
            baudRate: baudrate,
          }),
        );
        if (activeSession) {
          return res.json({
            success: true,
            message: `El puerto serial ${serialPort} ya tiene una consola activa en la aplicación.`,
            data: {
              typeDevice,
              protocol,
              status: null,
              version: null,
              latencyMs: null,
            },
          });
        }

        const client = new SerialPortClient(serialPort, baudrate);
        const startedAt = Date.now();

        try {
          await withTimeout(client.connect(), SERIAL_TIMEOUT_MS);
          const latencyMs = Date.now() - startedAt;
          return res.json({
            success: true,
            message: `Puerto serial ${serialPort} abierto correctamente (${latencyMs} ms).`,
            data: {
              typeDevice,
              protocol,
              status: null,
              version: null,
              latencyMs,
            },
          });
        } catch (error) {
          const latencyMs = Date.now() - startedAt;
          const detalle = errorDetail(error).replace(
            `Error al abrir puerto serial ${serialPort}: `,
            "",
          );
          return res.json({
            success: false,
            message: `No se pudo abrir el puerto serial ${serialPort} (${baudrate} baudios): ${detalle}. Verifica que exista y que no esté en uso.`,
            data: {
              typeDevice,
              protocol,
              status: null,
              version: null,
              latencyMs,
            },
          });
        } finally {
          await client.disconnect().catch(() => undefined);
        }
      }

      return res.status(400).json({
        success: false,
        message: `Protocolo no soportado para prueba de conexión: ${protocol || "(vacío)"}`,
        data: null,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.use(resourceRouter("deviceProviders", { roles: [Role.ADMIN, Role.STAFF] }));

export default router;
