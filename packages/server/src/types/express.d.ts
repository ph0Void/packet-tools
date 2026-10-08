import type { Role } from "../prisma/generated/enums";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; username: string; role: Role };
    }
  }
}

export {};
