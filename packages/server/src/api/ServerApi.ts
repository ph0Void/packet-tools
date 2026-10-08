import { Router } from "express";
import authRouter from "./router/AuthRouter";
import usersRouter from "./router/UsersRouter";
import chatsRouter from "./router/ChatsRouter";
import alertsRouter from "./router/AlertsRouter";
import devicesRouter from "./router/DevicesRouter";
import providersRouter from "./router/ProvidersRouter";
import topologiesRouter from "./router/TopologiesRouter";
import dataRouter from "./router/DataRouter";
import configRouter from "./router/ConfigRouter";
import jobsRouter from "./router/JobsRouter";
import logsRouter from "./router/LogsRouter";
import terminalRouter from "./router/TerminalRouter";
import gns3Router from "./router/Gns3Router";

export function createServerApi() {
  const api = Router();
  api.use("/auth", authRouter);
  api.use("/users", usersRouter);
  api.use("/chats", chatsRouter);
  api.use("/alerts", alertsRouter);
  api.use("/devices", devicesRouter);
  api.use("/providers", providersRouter);
  api.use("/topologies", topologiesRouter);
  api.use("/data", dataRouter);
  api.use("/config", configRouter);
  api.use("/jobs", jobsRouter);
  api.use("/logs", logsRouter);
  api.use("/terminal", terminalRouter);
  api.use("/gns3", gns3Router);
  api.get("/health", (_req, res) => res.json({ success: true, message: "Sistema funcionando correctamente", data: null }));
  return api;
}
