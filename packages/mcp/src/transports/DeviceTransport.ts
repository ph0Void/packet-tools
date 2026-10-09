/**
 * `DeviceTransport`: la abstracción común de transporte.
 *
 * POR QUÉ EXISTE
 * El servidor tenía tres clientes de terminal (SSH, Telnet, Serial) sin nada en
 * común: `executeCommands` en dos de ellos y `executeCommand` en el otro,
 * constructores distintos y opciones declaradas tres veces por separado. Eso
 * hacía que agregar un protocolo nuevo obligara a tocar cada punto donde se
 * despachaba por protocolo.
 *
 * Aquí se define UNA interfaz de cuatro métodos (`connect`, `sendCommand`,
 * `readOutput`, `disconnect`) y cada protocolo la implementa en su adaptador.
 * El registro de dominios y el motor de comandos trabajan contra esta interfaz,
 * así que añadir un transporte futuro (por ejemplo SNMP o una API REST de un
 * fabricante) es escribir un adaptador y registrarlo: **no se toca el núcleo**.
 *
 * Los cuatro métodos se eligieron porque son los que de verdad varían entre
 * protocolos; todo lo demás (resolver vendor, sanear comandos, esperar prompt,
 * recortar salida) es lógica común y vive fuera, en `transports/commandEngine.ts`.
 */

/** Protocolos soportados. El nombre coincide con el de los namespaces de tools. */
export type ProtocoloTransporte = "SSH" | "TELNET" | "SERIAL";

/** Credenciales y destino de una conexión. Todos los campos salvo `protocol` son opcionales. */
export interface OpcionesConexion {
  protocol: ProtocoloTransporte;
  /** Host del equipo (SSH/Telnet). No se usa en serie. */
  host?: string | null;
  /** Puerto TCP (SSH/Telnet). */
  port?: number | null;
  /** Ruta del puerto serie (`COM3`, `/dev/ttyUSB0`). Solo serie. */
  serialPort?: string | null;
  /** Velocidad del puerto serie (por defecto 9600). Solo serie. */
  baudRate?: number | null;

  username?: string | null;
  password?: string | null;
  /** Clave privada PEM en texto. Solo SSH. */
  privateKey?: string | null;

  /**
   * Id del proveedor de la BD propia del MCP (`DeviceProviderMcp.id`), si la
   * conexión salió de una fila configurada. Se arrastra para poder cachear la
   * detección de fabricante y para los mensajes de error.
   */
  providerId?: string | null;

  /**
   * Tipo declarado del equipo (`DeviceProviderMcp.typeDevice`). Alimenta el
   * nivel 1 de la resolución de vendor; si falta, se detecta por el prompt.
   */
  typeDevice?: string | null;
}

/** Resultado de un comando, ya saneado y recortado. */
export interface ResultadoComando {
  /** Salida capturada (sin ecos de teclado ni secuencias ANSI). */
  output: string;
  /** Prompt detectado al terminar, si se pudo reconocer. */
  prompt: string | null;
  /** Id del perfil de fabricante usado para hablar con el equipo. */
  vendorId: string;
  /** Nombre legible del fabricante (para el mensaje al modelo). */
  vendorLabel: string;
  /** true si la detección del fabricante se hizo en esta llamada (no venía cacheada). */
  vendorDetectado: boolean;
  /** Cuánto tardó el comando, en milisegundos. */
  duracionMs: number;
}

/**
 * La interfaz que implementa cada protocolo.
 *
 * Contrato: `sendCommand` NO abre la conexión (para eso está `connect`) y
 * `readOutput` se puede llamar sin haber enviado nada, para leer el estado
 * inicial de una consola recién conectada (que es como se detecta el fabricante).
 */
export interface DeviceTransport {
  /** Protocolo que implementa este adaptador. */
  readonly protocol: ProtocoloTransporte;
  /** true si la conexión está abierta y utilizable. */
  isConnected(): boolean;

  /** Abre la conexión. Debe ser idempotente (llamar dos veces no debe romper). */
  connect(): Promise<void>;
  /** Cierra la conexión. No debe lanzar si ya estaba cerrada. */
  disconnect(): Promise<void>;

  /**
   * Envía un comando al equipo (ya saneado por el motor de comandos).
   * El terminador de línea lo añade el adaptador: es específico del protocolo.
   */
  sendCommand(command: string): Promise<void>;

  /**
   * Acumula salida hasta que la consola se queda en silencio `idleMs` o se
   * agota `maxMs`. Devuelve lo leído y lo limpia del búfer.
   */
  readOutput(options?: { idleMs?: number; maxMs?: number }): Promise<string>;
}

/**
 * Opciones del ciclo de comandos del motor común.
 * Es el subconjunto que de verdad se usa, para no exponer los detalles de cada
 * cliente.
 */
export interface OpcionesEjecucion {
  idleMs?: number;
  maxMs?: number;
  /** Fuerza un perfil de fabricante en vez de detectarlo (para pruebas). */
  vendorIdForzado?: string | null;
  /** Omite el preámbulo del perfil (paginación/DNS). Por defecto se envía. */
  sinPreambulo?: boolean;
}
