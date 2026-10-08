import { Bullets, Callout, CodeBlock, Paragraph, Steps, SubTitle } from "./primitives";

const EJEMPLO_SKILL = `# Cuándo usarla

Cuando hay que configurar OSPF área 0 entre routers Cisco en una red simple.
No usar si la red tiene más de un área.

# Pasos

1. Entrar en modo de configuración: \`configure terminal\`.
2. Activar OSPF: \`router ospf 1\`.
3. Anunciar cada red: \`network <red> <wildcard> area 0\`.
4. Verificar vecinos: \`show ip ospf neighbor\` (debe decir FULL).
5. Comprobar rutas: \`show ip route | include O\`.

# Precauciones

- No anunciar interfaces que no participan en OSPF.
- Guardar al final con \`copy running-config startup-config\`.`;

export default function SkillsSeccion() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Skills</strong> son recetas guardadas: pasos ya preparados para
        trabajos repetidos (por ejemplo, “configurar OSPF” o “revisar un
        router”). El asistente las usa para hacerlo más rápido y sin
        equivocarse.
      </Paragraph>

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Crea la receta",
            description:
              "En Skills pulsa Nueva skill, ponle un título, escribe en una frase cuándo debe usarse y pega los pasos en el contenido.",
          },
          {
            title: "Úsala desde el Chat",
            description:
              "En el Chat escribe @skill: seguido de su nombre (por ejemplo @skill:configurar-ospf-area-0) junto a tu pedido.",
          },
        ]}
      />

      <SubTitle>Ejemplo para copiar y editar</SubTitle>
      <Paragraph>
        Título sugerido: <strong>Configurar OSPF área 0</strong>. Cuándo
        usarla: <em>Para enlazar routers OSPF en área 0 cuando la red es
        simple.</em> Y este contenido (usa el botón de copiar):
      </Paragraph>
      <CodeBlock code={EJEMPLO_SKILL} label="Contenido de ejemplo (Markdown)" />

      <SubTitle>Pautas para una buena skill</SubTitle>
      <Bullets
        items={[
          "Título corto y claro: que con solo leerlo se entienda qué hace.",
          "El “cuándo usarla” en una frase, incluyendo cuándo NO usarla.",
          "Pasos numerados, uno por acción, con el comando exacto entre comillas.",
          "Agrega una sección de Precauciones con lo que no se debe olvidar.",
          "Sé preciso y accionable: el asistente solo lee el título y la descripción primero, y abre el contenido solo cuando lo necesita.",
        ]}
      />

      <Callout variant="tip" title="Permisos">
        Crear y editar skills lo pueden hacer STAFF y ADMIN. Borrar, solo
        ADMIN. También puedes pedirle al Chat: “crea una skill para…”.
      </Callout>
    </div>
  );
}
