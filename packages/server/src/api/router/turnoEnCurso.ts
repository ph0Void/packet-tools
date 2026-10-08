export type CodigoRechazoEnvio = "DUPLICADO" | "TURNO_EN_CURSO" | "YA_REINTENTADO";

export const MENSAJE_ENVIO_DUPLICADO =
  "Este mensaje ya se había enviado en esta conversación: no se ha vuelto a enviar.";

export const MENSAJE_TURNO_EN_CURSO =
  "Esta conversación ya tiene un turno en curso: espera a que termine antes de enviar otro.";

export const MENSAJE_YA_REINTENTADO =
  "Este mensaje ya tiene una respuesta del asistente: no se vuelve a generar otra.";

export const MAX_CLIENT_MESSAGE_ID = 64;
const FORMA_CLIENT_MESSAGE_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function esClientMessageIdValido(valor: unknown): valor is string {
  return typeof valor === "string" && FORMA_CLIENT_MESSAGE_ID.test(valor);
}

export interface CuerpoEnvioRechazado {
  success: false;
  message: string;
  code: CodigoRechazoEnvio;
  data: {

    messageId?: string;

    message?: unknown;

    assistantMessageId?: string | null;
  } | null;
}

export function cuerpoEnvioRechazado(
  codigo: CodigoRechazoEnvio,
  existente?: { id?: string; message?: unknown; assistantMessageId?: string | null } | null,
): CuerpoEnvioRechazado {
  if (codigo === "DUPLICADO") {
    return {
      success: false,
      message: MENSAJE_ENVIO_DUPLICADO,
      code: codigo,
      data: {
        ...(existente?.id ? { messageId: existente.id } : {}),
        ...(existente?.message !== undefined ? { message: existente.message } : {}),
      },
    };
  }
  if (codigo === "YA_REINTENTADO") {
    return {
      success: false,
      message: MENSAJE_YA_REINTENTADO,
      code: codigo,
      data: {
        ...(existente?.assistantMessageId
          ? { assistantMessageId: existente.assistantMessageId }
          : {}),
      },
    };
  }
  return { success: false, message: MENSAJE_TURNO_EN_CURSO, code: codigo, data: null };
}

export interface TurnoEnCurso {
  chatId: string;

  clientMessageId: string | null;

  messageId: string | null;

  abiertoEn: number;
}

export interface DatosAperturaTurno {
  clientMessageId?: string | null;
}

export interface ReservaTurno {

  registrarMensaje(messageId: string): void;

  liberar(): void;
}

export class RegistroTurnosEnCurso {
  private readonly turnos = new Map<string, TurnoEnCurso>();

  reservar(chatId: string, datos: DatosAperturaTurno = {}): ReservaTurno | null {
    if (this.turnos.has(chatId)) return null;
    const turno: TurnoEnCurso = {
      chatId,
      clientMessageId: datos.clientMessageId ?? null,
      messageId: null,
      abiertoEn: Date.now(),
    };
    this.turnos.set(chatId, turno);
    return {
      registrarMensaje: (messageId: string) => {
        if (this.turnos.get(chatId) === turno) turno.messageId = messageId;
      },
      liberar: () => {
        if (this.turnos.get(chatId) === turno) this.turnos.delete(chatId);
      },
    };
  }

  hayTurnoEnCurso(chatId: string): boolean {
    return this.turnos.has(chatId);
  }

  turnoEnCurso(chatId: string): TurnoEnCurso | null {
    return this.turnos.get(chatId) ?? null;
  }

  get chatsConTurno(): string[] {
    return [...this.turnos.keys()];
  }
}

export const registrarTurnosEnCurso = new RegistroTurnosEnCurso();
