import { Bullets, Paragraph, Steps, SubTitle } from "./primitives";

export default function Modelos() {
  return (
    <div className="space-y-5">
      <Paragraph>
        <strong>Configuración</strong> (Modelos de IA) es donde el administrador
        elige el “cerebro” del asistente: qué inteligencia artificial responde y
        con qué instrucciones generales trabaja.
      </Paragraph>

      <SubTitle>Proveedores que acepta</SubTitle>
      <Bullets
        items={[
          "En la nube: OpenAI, Google, Anthropic y OpenRouter (necesitan su clave/API Key).",
          "En tu propio equipo: Ollama y LM Studio (sin clave, solo la dirección del programa).",
          "Personalizado (Custom): cualquier otro servicio compatible, con su dirección y clave.",
        ]}
      />

      <SubTitle>Dos cosas que debes elegir</SubTitle>
      <Bullets
        items={[
          "Tipo de modelo: CHAT para conversar y responder, o EMBEDDING para que entienda tus documentos de Datos (sin un EMBEDDING activo, los documentos no se indexan).",
          "Prompt del Sistema: las instrucciones generales que el asistente sigue en cada conversación (por ejemplo, cómo debe responder). Se edita y se guarda con Guardar Prompt.",
        ]}
      />

      <SubTitle>Cómo se usa</SubTitle>
      <Steps
        items={[
          {
            title: "Agrega un modelo",
            description:
              "Pulsa Agregar Modelo, elige el proveedor y el tipo (CHAT o EMBEDDING), y pega tu clave si es de la nube.",
          },
          {
            title: "Prueba que funciona",
            description:
              "Pulsa Probar Conexión. Si responde correctamente, guarda los cambios.",
          },
          {
            title: "Déjalo activo",
            description:
              "Asegúrate de que el interruptor de Activo quede encendido para que el Chat lo use.",
          },
        ]}
      />
    </div>
  );
}
