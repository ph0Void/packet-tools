import request from "supertest";
import { describe, expect, it } from "vitest";
import { publicApi } from "./helpers";

describe("GET /api/health", () => {
  it("responde 200 con el formato estándar {success, message, data}", async () => {
    const response = await publicApi().get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.message).toBe("string");
    expect("data" in response.body).toBe(true);
  });
});
