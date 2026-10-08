import type { Request } from "express";
import request from "supertest";
import type { Agent } from "superagent";
import { app } from "@/app";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { BcryptAdapter } from "@/utils/BcryptAdapter";

export function publicApi() {
  return request(app);
}


let testAdmin: { username: string; password: string } | null = null;


export async function ensureTestAdmin() {
  if (!testAdmin) {
    const username = "vitest_suite_admin";
    const password = `secret_${Date.now()}`;
    const existing = await prismaClient.user.findUnique({ where: { username } });
    if (existing) {
      await prismaClient.user.update({ where: { id: existing.id }, data: { password: BcryptAdapter.hash(password), role: "ADMIN" } });
    } else {
      await prismaClient.user.create({ data: { username, password: BcryptAdapter.hash(password), role: "ADMIN" } });
    }
    testAdmin = { username, password };
  }
  return testAdmin;
}


export async function createTestUser(role: "USER" | "STAFF" | "ADMIN" = "USER") {
  const username = `test_${role.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = `secret_${Date.now()}`;
  const response = await publicApi().post("/api/users").set("Authorization", await adminBearer()).send({ username, password, role });
  if (!response.ok && response.status !== 409) throw new Error(`No se pudo crear el usuario de prueba: ${JSON.stringify(response.body)}`);
  return { username, password, role };
}


export async function sessionFor(username: string, password: string) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/login").send({ username, password });
  if (!response.ok) throw new Error(`Login falló para ${username}: ${JSON.stringify(response.body)}`);
  return agent as unknown as Agent & ((test: string) => Request);
}


let cachedBearer: string | null = null;
export async function adminBearer(): Promise<string> {
  if (cachedBearer) {
    const check = await publicApi().get("/api/auth/me").set("Authorization", cachedBearer);
    if (check.ok) return cachedBearer;
    cachedBearer = null;
  }
  const admin = await ensureTestAdmin();
  const login = await publicApi().post("/api/auth/login").send(admin);
  if (!login.ok) throw new Error(`Login admin falló: ${JSON.stringify(login.body)}`);
  const cookie = login.headers["set-cookie"]?.[0] ?? "";
  cachedBearer = cookie.split(";")[0].replace("packet-tools-cookie=", "Bearer ");
  return cachedBearer;
}


export async function removeTestUser(username: string) {
  try {
    const list = await publicApi().get("/api/users").set("Authorization", await adminBearer());
    const found = (list.body.data ?? []).find((user: any) => user.username === username);
    if (found) await publicApi().delete(`/api/users/${found.id}`).set("Authorization", await adminBearer());
  } catch {

  }
}
