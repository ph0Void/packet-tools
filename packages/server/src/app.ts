import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { envConfig } from "./config/EnvConfig";
import { createServerApi } from "./api/ServerApi";
import { errorMiddleware } from "./middleware/error.middleware";
import { registerSimulationSocket } from "./sockets/simulation.socket";
import { registerTerminalSocket } from "./sockets/terminal.socket";
import { registerSocketAuth } from "./sockets/socket.auth";
import { Logger } from "./utils/Logger";
import { detenerProgramador, iniciarProgramador } from "./service/JobScheduler";

export const app = express();

function origenesPermitidos(): string[] {
  const puertoWeb = process.env.PORT || "3090";
  const puertoApi = process.env.SERVER_PORT || "7531";
  const crudo =
    process.env.CORS_ORIGINS ?? `http://localhost:${puertoWeb},http://localhost:${puertoApi}`;
  return crudo.split(",").map((o) => o.trim()).filter(Boolean);
}

function origenPermitido(origin: string | undefined): boolean {
  if (!origin) return true;
  return origenesPermitidos().includes(origin);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (origenPermitido(origin)) return callback(null, true);
      callback(null, false);
    },
    credentials: true,
  }),
);

app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.headers.origin && !origenesPermitidos().includes(String(req.headers.origin))) {
    return res.status(403).json({ success: false, message: "Origen no permitido" });
  }
  next();
});
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
app.use("/api", createServerApi());
app.use(errorMiddleware);

const server = createServer(app);
const io = new Server(server, { cors: { origin: (origin, cb) => cb(null, origenPermitido(origin)), credentials: true } });
registerSocketAuth(io);
registerSimulationSocket(io);
registerTerminalSocket(io);

let apagadoIniciado = false;

function detenerTareasProgramadas(): void {
  if (apagadoIniciado) return;
  apagadoIniciado = true;
  try {
    detenerProgramador();
  } catch (error) {
    Logger.error({
      message: "[APP] Error deteniendo el planificador de tareas programadas.",
      data: error instanceof Error ? error.message : String(error),
    });
  }
}

async function arrancar(): Promise<void> {
  if (process.env.NODE_ENV !== "test") {
    try {
      await iniciarProgramador();
    } catch (error) {
      Logger.error({
        message: "[APP] No se pudo iniciar el planificador de tareas programadas; el servidor sigue levantando.",
        data: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!process.env.VITEST && process.env.NODE_ENV !== "test") server.listen(envConfig.SERVER_PORT, () => console.log(`BACKEND corriendo en http://localhost:${envConfig.SERVER_PORT}`));
}

if (process.env.NODE_ENV !== "test") {

  for (const señal of ["SIGINT", "SIGTERM"] as const) {
    process.on(señal, () => {
      detenerTareasProgramadas();
      process.exit(0);
    });
  }
  server.on("close", detenerTareasProgramadas);
}

void arrancar();
export { server, io };
