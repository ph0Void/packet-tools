import { Router } from "express";
import { authMiddleware } from "@/middleware/auth.middleware";
import { terminalSessionHub } from "@/sockets/TerminalSessionHub";

const router = Router();
router.use(authMiddleware);
router.get("/sessions", (req, res, next) => { try { const data = terminalSessionHub.listSessions(req.user!.id).filter((session) => session.alive).map(({ sessionId, deviceName, protocol, providerId, busy, prompt }) => ({ sessionId, deviceName, protocol, providerId, busy, prompt })); res.json({ success: true, message: "Sesiones activas", data }); } catch (error) { next(error); } });
export default router;
