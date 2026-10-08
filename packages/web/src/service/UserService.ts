import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface AppUser {
  id: string;
  username: string;
  role: "USER" | "STAFF" | "ADMIN";
  createdAt: string;
}

export interface UserInput {
  username: string;
  password: string;
  role?: "USER" | "STAFF" | "ADMIN";
}

export interface UserUpdateInput {
  username?: string;
  password?: string;
  role?: "USER" | "STAFF" | "ADMIN";
}

export function getAllUsers(): Promise<ApiResponse<AppUser[]>> {
  return api<AppUser[]>("/api/users");
}

export function createUser(input: UserInput): Promise<ApiResponse<AppUser>> {
  return api<AppUser>("/api/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateUser(
  id: string,
  input: UserUpdateInput,
): Promise<ApiResponse<AppUser>> {
  return api<AppUser>(`/api/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteUser(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/users/${id}`, { method: "DELETE" });
}
