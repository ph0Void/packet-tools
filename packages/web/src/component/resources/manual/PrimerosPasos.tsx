import { ExternalLink } from "lucide-react";
import { Paragraph, Steps, SubTitle } from "./primitives";

const REFERENCES = [
  {
    title: "Plugin Packet Tracer",
    url: "https://github.com/ph0Void/packet-tools/releases/tag/plugin",
    description: "Plugin para conectar Packet Tracer con el asistente.",
  },
  {
    title: "Instalar en Windows",
    url: "https://github.com/ph0Void/packet-tools/releases/latest",
    description: "Instalador de Packet Tools para Windows.",
  },
  {
    title: "Instalar en Linux",
    url: "https://github.com/ph0Void/packet-tools/releases/latest",
    description: "Instalador de Packet Tools para Linux.",
  },
  {
    title: "Simulador Packet Tracer",
    url: "https://www.netacad.com/resources/lab-downloads",
    description: "Simulador oficial de redes de Cisco.",
  },
  {
    title: "Instalador GNS3",
    url: "https://www.gns3.com/",
    description: "Simulador de redes open-source.",
  },
  {
    title: "Packet Tools Github",
    url: "https://github.com/ph0Void/packet-tools",
    description: "Repositorio de código abierto.",
  },
];

export default function PrimerosPasos() {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SubTitle>Bienvenido a Packet Tools</SubTitle>
        <Paragraph>
          Packet Tools es tu ayudante para cuidar tu red: te avisa de fallos, te
          deja hablar con tus equipos y hace tareas por ti. No necesitas saber
          comandos: escríbele como a una persona desde el Chat.
        </Paragraph>
        <Steps
          items={[
            {
              title: "Crea tu cuenta",
              description:
                "En la pantalla de acceso pulsa Regístrate, elige un nombre y una contraseña, y entra.",
            },
            {
              title: "Agrega un equipo",
              description:
                "Ve a Conexiones, pulsa Nuevo dispositivo y guarda tu primer equipo.",
            },
            {
              title: "Pide algo al asistente",
              description:
                "Ve al Chat y escríbele, por ejemplo: “dime si mi router responde”.",
            },
          ]}
        />
      </section>

      <section className="space-y-2">
        <SubTitle>Enlaces de referencia</SubTitle>
        <Paragraph>Programas y descargas que te pueden hacer falta.</Paragraph>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {REFERENCES.map((ref) => (
            <li key={ref.title}>
              <a
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col gap-1 rounded-lg border border-border p-4 transition-all duration-200 hover:border-primary/50 hover:bg-muted/40"
              >
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                  {ref.title}
                  <ExternalLink className="h-3.5 w-3.5" />
                </span>
                <span className="text-xs text-muted-foreground">
                  {ref.description}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
