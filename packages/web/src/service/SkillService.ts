export interface Skill {
  id: string;
  title: string;
  description: string | null;
  content: string;
  updatedAt: string;
}

interface ApiEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

async function pedir<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  return (await res.json()) as ApiEnvelope<T>;
}

export async function getSkills(): Promise<ApiEnvelope<Skill[]>> {
  try {
    return await pedir<Skill[]>("/api/data/skills");
  } catch {
    return { success: false, message: "No se pudieron cargar las skills." };
  }
}

export async function createSkill(input: {
  title: string;
  description?: string;
  content: string;
}): Promise<ApiEnvelope<Skill>> {
  return pedir<Skill>("/api/data/skills", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSkill(
  id: string,
  input: { title?: string; description?: string | null; content?: string },
): Promise<ApiEnvelope<Skill>> {
  return pedir<Skill>(`/api/data/skills/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteSkill(id: string): Promise<ApiEnvelope<null>> {
  return pedir<null>(`/api/data/skills/${id}`, { method: "DELETE" });
}
