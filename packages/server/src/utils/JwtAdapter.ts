import jwt from "jsonwebtoken";
import { envConfig } from "../config/EnvConfig";

const JWT_SECRET = envConfig.JWT_SECRET;
const RAW_EXPIRATION = envConfig.JWT_EXPIRATION || "30d";

const JWT_EXPIRATION: string | number = /^\d+$/.test(RAW_EXPIRATION)
  ? Number(RAW_EXPIRATION)
  : RAW_EXPIRATION;

export class JwtAdapter {
  static generateToken(payload: any, expiresIn: string | number = JWT_EXPIRATION): string {
    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: expiresIn,
    } as any);
  }

  static verifyToken<T = any>(token: string): T | null {
    try {
      return jwt.verify(token, JWT_SECRET) as T;
    } catch (error) {
      return null;
    }
  }

  static isValidToken(token: string) {
    try {
      jwt.verify(token, JWT_SECRET);
      return true;
    } catch (error) {
      return false;
    }
  }
}
