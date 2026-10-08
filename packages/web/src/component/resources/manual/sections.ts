import {
  BookOpen,
  Bot,
  BrainCircuit,
  Clock,
  Database,
  LayoutDashboard,
  Logs,
  MessageCircleWarning,
  MessageSquare,
  Rocket,
  Router,
  Sparkles,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import PrimerosPasos from "./PrimerosPasos";
import Inicio from "./Inicio";
import Modelos from "./Modelos";
import Conexiones from "./Conexiones";
import Usuarios from "./Usuarios";
import TerminalSeccion from "./TerminalSeccion";
import Alertas from "./Alertas";
import Tareas from "./Tareas";
import LogsSeccion from "./LogsSeccion";
import DatosRag from "./DatosRag";
import Chat from "./Chat";
import Agente from "./Agente";
import SkillsSeccion from "./SkillsSeccion";
import Anexos from "./Anexos";

export interface ManualSectionMeta {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  Component: ComponentType;
}

export const MANUAL_SECTIONS: ManualSectionMeta[] = [
  {
    id: "primeros-pasos",
    title: "Primeros pasos",
    description: "Qué es Packet Tools y cómo empezar en 3 pasos.",
    keywords: ["login", "sesión", "registro", "empezar", "bienvenida"],
    icon: Rocket,
    Component: PrimerosPasos,
  },
  {
    id: "inicio",
    title: "Inicio",
    description: "La pantalla principal: resumen de tu red de un vistazo.",
    keywords: ["dashboard", "panel", "resumen", "inicio"],
    icon: LayoutDashboard,
    Component: Inicio,
  },
  {
    id: "alertas",
    title: "Alertas",
    description: "Dónde se anotan y resuelven los problemas de la red.",
    keywords: ["incidencia", "aviso", "criticidad", "resolver", "reportar"],
    icon: MessageCircleWarning,
    Component: Alertas,
  },
  {
    id: "chat",
    title: "Chat",
    description: "Tu asistente con inteligencia artificial: pídele con palabras normales.",
    keywords: ["asistente", "ia", "conversación", "chat", "preguntar"],
    icon: MessageSquare,
    Component: Chat,
  },
  {
    id: "agente",
    title: "Agente",
    description: "Quién hace el trabajo: ayudantes por equipo y sus herramientas.",
    keywords: ["agente", "subagente", "subagentes", "tools", "herramientas", "packet tracer", "gns3", "ssh", "telnet", "serial", "planificación", "hitl", "aprobación", "autónomo"],
    icon: Bot,
    Component: Agente,
  },
  {
    id: "conexiones",
    title: "Conexiones",
    description: "Tu lista de equipos de red para usarlos desde el Chat y la Terminal.",
    keywords: ["dispositivos", "equipos", "ssh", "telnet", "serial", "gns3", "packet tracer", "agregar"],
    icon: Router,
    Component: Conexiones,
  },
  {
    id: "terminal",
    title: "Terminal",
    description: "Ventana directa a tu equipo para escribirle y leer su respuesta.",
    keywords: ["consola", "comandos", "conectar", "terminal"],
    icon: Terminal,
    Component: TerminalSeccion,
  },
  {
    id: "automatizaciones",
    title: "Automatizaciones",
    description: "Trabajos que se hacen solos en el día y hora que elijas.",
    keywords: ["jobs", "tareas", "programar", "automático", "cron"],
    icon: Clock,
    Component: Tareas,
  },
  {
    id: "skills",
    title: "Skills",
    description: "Recetas guardadas para trabajos repetidos.",
    keywords: ["skills", "recetas", "plantillas", "@skill"],
    icon: Sparkles,
    Component: SkillsSeccion,
  },
  {
    id: "logs",
    title: "Logs",
    description: "El diario del sistema: qué pasó y cuándo.",
    keywords: ["eventos", "historial", "diario", "error", "ver"],
    icon: Logs,
    Component: LogsSeccion,
  },
  {
    id: "datos",
    title: "Datos",
    description: "La biblioteca del asistente: sube documentos para que los consulte.",
    keywords: ["rag", "documentos", "pdf", "biblioteca", "@rag"],
    icon: Database,
    Component: DatosRag,
  },
  {
    id: "usuarios",
    title: "Usuarios",
    description: "Quién puede entrar, qué rol tiene y qué puede hacer.",
    keywords: ["operadores", "cuentas", "rol", "admin", "staff", "user", "permisos"],
    icon: Users,
    Component: Usuarios,
  },
  {
    id: "configuracion",
    title: "Configuración",
    description: "El cerebro del asistente: qué inteligencia artificial responde.",
    keywords: ["configuración", "modelos", "ia", "llm", "openai", "ollama", "api key"],
    icon: BrainCircuit,
    Component: Modelos,
  },
  {
    id: "anexos",
    title: "Anexos y referencias",
    description: "Comandos más usados de Cisco, MikroTik, Huawei y Aruba.",
    keywords: ["comandos", "cisco", "mikrotik", "huawei", "aruba", "cheat sheet", "referencias"],
    icon: BookOpen,
    Component: Anexos,
  },
];
