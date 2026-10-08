export interface AdjuntoLegible {
  id?: string | null;
  fileName?: string;
  fileType?: string | null;
  mimeType?: string | null;

  fileUrl?: string | null;
}

export function urlDeAdjunto(id: string): string {
  return `/api/chats/attachments/${encodeURIComponent(id)}`;
}

export function tieneContenidoServible(att: AdjuntoLegible): boolean {
  return typeof att.id === "string" && att.id.length > 0;
}

export function esImagenServible(att: AdjuntoLegible): boolean {
  if (att.fileType === "IMAGE") return true;
  if (att.fileType === "DOCUMENT") return false;
  return (att.mimeType ?? "").trim().toLowerCase().startsWith("image/");
}
