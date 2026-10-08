export type ToolAccess = "readonly" | "mutating" | "internal";

export type ToolKind =
  | "cli"
  | "topology"
  | "knowledge"
  | "simulation"
  | "internal";

export interface ToolPolicyEntry {
  access: ToolAccess;
  kind: ToolKind;
  label: string;

  commandsField?: "command" | "commands";

  autoApprove?: boolean;
}

export const TOOL_POLICIES: Record<string, ToolPolicyEntry> = {

  listDeviceProviders: {
    access: "readonly",
    kind: "knowledge",
    label: "Listar dispositivos",
  },
  search_knowledge_base: {
    access: "readonly",
    kind: "knowledge",
    label: "Buscar en base de conocimiento",
  },
  search_web_tool: {
    access: "readonly",
    kind: "knowledge",
    label: "Buscar en internet",
  },
  fetch_web_page_tool: {
    access: "readonly",
    kind: "knowledge",
    label: "Leer página web",
  },

  listCronJobs: {
    access: "readonly",
    kind: "internal",
    label: "Listar tareas programadas",
  },
  listDeviceProvidersAdmin: {
    access: "readonly",
    kind: "internal",
    label: "Listar conexiones",
  },
  getSystemMetrics: {
    access: "readonly",
    kind: "internal",
    label: "Consultar métricas del sistema",
  },
  findDeviceByName: {
    access: "readonly",
    kind: "knowledge",
    label: "Buscar dispositivo por nombre",
  },
  listSkills: {
    access: "readonly",
    kind: "internal",
    label: "Listar skills",
  },

  load_tools: {
    access: "readonly",
    kind: "internal",
    label: "Cargar herramientas bajo demanda",
  },

  createCronJob: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Crear tarea programada",
  },
  updateCronJob: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Actualizar tarea programada",
  },
  toggleCronJob: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Activar/desactivar tarea programada",
  },
  deleteCronJob: {
    access: "mutating",
    kind: "internal",
    label: "Eliminar tarea programada",
  },
  createDeviceProvider: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Crear conexión",
  },
  updateDeviceProvider: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Actualizar conexión",
  },
  deleteDeviceProvider: {
    access: "mutating",
    kind: "internal",
    label: "Eliminar conexión",
  },
  testDeviceProviderConnection: {
    access: "readonly",
    kind: "internal",
    label: "Probar conexión",
  },
  updateGlobalSystemPrompt: {
    access: "mutating",
    kind: "internal",
    label: "Actualizar prompt global del sistema",
  },

  setAgentLogsEnabled: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Activar/desactivar traza del agente",
  },

  createSkill: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Crear skill",
  },
  updateSkill: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Actualizar skill",
  },
  deleteSkill: {
    access: "mutating",
    kind: "internal",
    label: "Eliminar skill",
  },
  createKnowledgeDocument: {
    access: "mutating",
    kind: "internal",
    autoApprove: true,
    label: "Crear documento de conocimiento",
  },

  getNetwork: {
    access: "readonly",
    kind: "simulation",
    label: "Consultar topología",
  },
  getDeviceInfo: {
    access: "readonly",
    kind: "simulation",
    label: "Consultar dispositivo",
  },
  getSimulationStatus: {
    access: "readonly",
    kind: "simulation",
    label: "Estado de simulación",
  },
  getPduResults: {
    access: "readonly",
    kind: "simulation",
    label: "Resultados de PDU",
  },
  getCommandLog: {
    access: "readonly",
    kind: "simulation",
    label: "Historial de comandos",
  },

  pingTopology: {
    access: "readonly",
    kind: "simulation",
    label: "Ping de topología",
  },
  reachMatrix: {
    access: "readonly",
    kind: "simulation",
    label: "Matriz de alcance",
  },
  runDeviceCommand: {
    access: "readonly",
    kind: "topology",
    label: "Comandos de solo lectura",
    commandsField: "command",
  },
  validateTopology: {
    access: "readonly",
    kind: "topology",
    label: "Validar topología",
  },
  listDeviceModels: {
    access: "readonly",
    kind: "topology",
    label: "Listar modelos de dispositivo",
  },
  listDeviceModules: {
    access: "readonly",
    kind: "topology",
    label: "Listar módulos del dispositivo",
  },
  subnetCalc: {
    access: "readonly",
    kind: "topology",
    label: "Calcular subredes",
  },
  getDeviceConfig: {
    access: "readonly",
    kind: "topology",
    label: "Leer configuración del dispositivo",
  },
  generateNetworkReport: {
    access: "readonly",
    kind: "topology",
    label: "Generar informe de red",
  },
  qaTopologySuite: {
    access: "readonly",
    kind: "topology",
    label: "Batería de comprobaciones QA",
  },

  readDeviceConsole: {
    access: "readonly",
    kind: "topology",
    label: "Leer consola del dispositivo",
  },
  getRoutingTable: {
    access: "readonly",
    kind: "topology",
    label: "Consultar tabla de rutas",
  },
  getVlanConfiguration: {
    access: "readonly",
    kind: "topology",
    label: "Consultar configuración de VLANs",
  },
  getDeviceMetrics: {
    access: "readonly",
    kind: "topology",
    label: "Métricas del dispositivo",
  },
  validateSecurityConfig: {
    access: "readonly",
    kind: "topology",
    label: "Validar configuración de seguridad",
  },
  listGns3Nodes: {
    access: "readonly",
    kind: "simulation",
    label: "Listar nodos GNS3",
  },
  listGns3Links: {
    access: "readonly",
    kind: "simulation",
    label: "Listar enlaces GNS3",
  },
  listGns3Projects: {
    access: "readonly",
    kind: "simulation",
    label: "Listar proyectos GNS3",
  },
  findGns3Project: {
    access: "readonly",
    kind: "simulation",
    label: "Buscar proyecto GNS3",
  },
  getGns3Project: {
    access: "readonly",
    kind: "simulation",
    label: "Consultar proyecto GNS3",
  },
  getGns3Templates: {
    access: "readonly",
    kind: "simulation",
    label: "Plantillas GNS3",
  },
  testGns3Connectivity: {
    access: "readonly",
    kind: "simulation",
    label: "Diagnóstico de conectividad GNS3",
  },
  listGns3Snapshots: {
    access: "readonly",
    kind: "simulation",
    label: "Listar snapshots GNS3",
  },
  getGns3ProjectStats: {
    access: "readonly",
    kind: "simulation",
    label: "Estadísticas de proyecto GNS3",
  },
  listGns3NodeFiles: {
    access: "readonly",
    kind: "simulation",
    label: "Archivos de nodo GNS3",
  },
  readGns3NodeLog: {
    access: "readonly",
    kind: "simulation",
    label: "Leer log de nodo GNS3",
  },
  getGns3ServerResources: {
    access: "readonly",
    kind: "simulation",
    label: "Recursos del servidor GNS3",
  },

  getGns3Template: {
    access: "readonly",
    kind: "simulation",
    label: "Consultar plantilla GNS3",
  },
  getGns3LinkCapture: {
    access: "readonly",
    kind: "simulation",
    label: "Estado de captura de enlace",
  },
  downloadGns3LinkPcap: {
    access: "readonly",
    kind: "simulation",
    label: "Descargar pcap GNS3",
  },
  exportGns3Project: {
    access: "readonly",
    kind: "simulation",
    label: "Exportar proyecto GNS3",
  },

  open_terminal_console: {
    access: "readonly",
    kind: "simulation",
    label: "Abrir consola",
  },
  openGns3Console: {
    access: "readonly",
    kind: "simulation",
    label: "Abrir consola GNS3",
  },

  sendPdu: {
    access: "readonly",
    kind: "simulation",
    label: "Enviar PDU",
  },

  createTopology: {
    access: "mutating",
    kind: "topology",
    label: "Crear topología",
  },
  addDevice: {
    access: "mutating",
    kind: "topology",
    label: "Agregar dispositivo",
  },
  addModule: {
    access: "mutating",
    kind: "topology",
    label: "Agregar módulo",
  },
  addLink: {
    access: "mutating",
    kind: "topology",
    label: "Agregar enlace",
  },
  removeDevice: {
    access: "mutating",
    kind: "topology",
    label: "Eliminar dispositivo",
  },
  removeLink: {
    access: "mutating",
    kind: "topology",
    label: "Eliminar enlace",
  },
  configurePcIp: {
    access: "mutating",
    kind: "topology",
    label: "Configurar IP de PC",
  },
  configureIosDevice: {
    access: "mutating",
    kind: "topology",
    label: "Configuración IOS",
    commandsField: "commands",
  },
  renameDevice: {
    access: "mutating",
    kind: "topology",
    label: "Renombrar dispositivo",
  },
  setPower: {
    access: "mutating",
    kind: "topology",
    label: "Encender/apagar dispositivo",
  },

  setSimulationMode: {
    access: "mutating",
    kind: "simulation",
    label: "Modo de simulación",
  },
  stepSimulation: {
    access: "mutating",
    kind: "simulation",
    label: "Avanzar simulación",
  },
  moveDevice: {
    access: "mutating",
    kind: "topology",
    label: "Mover dispositivo",
  },

  saveDeviceConfig: {
    access: "mutating",
    kind: "topology",
    label: "Guardar snapshot de configuración",
  },
  restoreDeviceConfig: {
    access: "mutating",
    kind: "topology",
    label: "Restaurar snapshot de configuración",
  },
  exportTopologyFile: {
    access: "mutating",
    kind: "topology",
    label: "Exportar topología a archivo",
  },
  importTopologyFile: {
    access: "mutating",
    kind: "topology",
    label: "Importar topología desde archivo",
  },
  clearWorkspace: {
    access: "mutating",
    kind: "topology",
    label: "Limpiar espacio de trabajo",
  },
  simulateLinkFailure: {
    access: "mutating",
    kind: "topology",
    label: "Simular caída de enlace",
  },
  restoreLink: {
    access: "mutating",
    kind: "topology",
    label: "Restaurar enlace",
  },
  createGns3Project: {
    access: "mutating",
    kind: "topology",
    label: "Crear proyecto GNS3",
  },

  openGns3Project: {
    access: "mutating",
    kind: "topology",
    label: "Abrir proyecto GNS3",
  },
  closeGns3Project: {
    access: "mutating",
    kind: "topology",
    label: "Cerrar proyecto GNS3",
  },

  deleteGns3Project: {
    access: "mutating",
    kind: "topology",
    label: "Eliminar proyecto GNS3",
  },
  createGns3Node: {
    access: "mutating",
    kind: "topology",
    label: "Crear nodo GNS3",
  },
  connectGns3Nodes: {
    access: "mutating",
    kind: "topology",
    label: "Conectar nodos GNS3",
  },
  controlGns3NodePower: {
    access: "mutating",
    kind: "topology",
    label: "Controlar energía de nodo GNS3",
  },
  sendGns3ConsoleCommands: {
    access: "mutating",
    kind: "topology",
    label: "Comandos consola GNS3",
    commandsField: "commands",
  },
  createGns3Snapshot: {
    access: "mutating",
    kind: "topology",
    label: "Crear snapshot GNS3",
  },
  restoreGns3Snapshot: {
    access: "mutating",
    kind: "topology",
    label: "Restaurar snapshot GNS3",
  },
  deleteGns3Snapshot: {
    access: "mutating",
    kind: "topology",
    label: "Eliminar snapshot GNS3",
  },

  createGns3Template: {
    access: "mutating",
    kind: "topology",
    label: "Crear plantilla GNS3",
  },
  updateGns3Template: {
    access: "mutating",
    kind: "topology",
    label: "Editar plantilla GNS3",
  },
  deleteGns3Template: {
    access: "mutating",
    kind: "topology",
    label: "Eliminar plantilla GNS3",
  },
  duplicateGns3Template: {
    access: "mutating",
    kind: "topology",
    label: "Duplicar plantilla GNS3",
  },
  startGns3LinkCapture: {
    access: "mutating",
    kind: "topology",
    label: "Iniciar captura de enlace",
  },
  stopGns3LinkCapture: {
    access: "mutating",
    kind: "topology",
    label: "Detener captura de enlace",
  },
  importGns3Project: {
    access: "mutating",
    kind: "topology",
    label: "Importar proyecto GNS3",
  },
  autoLayoutGns3Project: {
    access: "mutating",
    kind: "topology",
    label: "Auto-layout de proyecto GNS3",
  },

  ingest_document_to_chroma: {
    access: "mutating",
    kind: "knowledge",
    label: "Ingerir documento",
  },

  read_terminal: {
    access: "readonly",
    kind: "cli",
    label: "Lectura de terminal",
  },
  wait_for_prompt: {
    access: "readonly",
    kind: "cli",
    label: "Espera de prompt",
  },
  get_terminal_status: {
    access: "readonly",
    kind: "cli",
    label: "Estado de terminal",
  },
  send_command: {
    access: "mutating",
    kind: "cli",
    label: "Comando en consola",
    commandsField: "command",
  },

  configure_device: {
    access: "mutating",
    kind: "cli",
    label: "Configurar equipo por consola",
    commandsField: "commands",
  },
  executeSshCommands: {
    access: "mutating",
    kind: "cli",
    label: "Comandos SSH",
    commandsField: "commands",
  },
  executeTelnetCommands: {
    access: "mutating",
    kind: "cli",
    label: "Comandos Telnet",
    commandsField: "commands",
  },
  sendSerialCommand: {
    access: "mutating",
    kind: "cli",
    label: "Comando serial",
    commandsField: "command",
  },

  transfer_to_cisco_packet_tracer: {
    access: "internal",
    kind: "internal",
    label: "Transferir a Packet Tracer",
  },
  transfer_to_gns3: {
    access: "internal",
    kind: "internal",
    label: "Transferir a GNS3",
  },
  transfer_to_ssh: {
    access: "internal",
    kind: "internal",
    label: "Transferir a SSH",
  },
  transfer_to_telnet: {
    access: "internal",
    kind: "internal",
    label: "Transferir a Telnet",
  },
  transfer_to_serial: {
    access: "internal",
    kind: "internal",
    label: "Transferir a Puerto Serial",
  },
};

export function getToolPolicy(name: string): ToolPolicyEntry {
  return (
    TOOL_POLICIES[name] ?? {
      access: "mutating",
      kind: "topology",
      label: name,
    }
  );
}
