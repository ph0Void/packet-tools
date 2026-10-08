export type ItemStream = unknown;

export interface ChunkDelStream {

  mensaje: unknown;

  deSubgrafo: boolean;

  eraTupla: boolean;
}

export function mensajeDeStream(item: ItemStream): any {
  if (!Array.isArray(item)) return item;

  if (Array.isArray(item[1])) return mensajeDeStream(item[1]);

  const mensaje = item.find(
    (parte: unknown) =>
      parte &&
      typeof parte === "object" &&
      typeof (parte as { getType?: unknown }).getType === "function",
  );
  return mensaje ?? item[0];
}

export function analizarChunkDelStream(item: ItemStream): ChunkDelStream {
  if (!Array.isArray(item)) {
    return { mensaje: item, deSubgrafo: false, eraTupla: false };
  }
  const deSubgrafo = typeof item[0] === "string" && Array.isArray(item[1]);
  return { mensaje: mensajeDeStream(item), deSubgrafo, eraTupla: true };
}
