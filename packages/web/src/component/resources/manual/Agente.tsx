import {
  InlineCode,
  Paragraph,
  SimpleTable,
  SubTitle,
} from "./primitives";

export default function Agente() {
  return (
    <div className="space-y-5">
      <Paragraph>
        El <strong>Agente</strong> es el asistente que vive en el Chat. Tú le
        pides algo con palabras normales y él reparte el trabajo entre sus
        ayudantes (subagentes), donde cada uno sabe manejar un tipo de equipo o
        tarea.
      </Paragraph>

      <SubTitle>Cómo funciona (en sencillo)</SubTitle>
      <Paragraph>
        Tú escribes tu pedido una sola vez. El agente entiende qué necesitas,
        llama al ayudante indicado y te muestra el resultado. Si lo que pides
        cambia algo importante del equipo, primero te pide permiso.
      </Paragraph>

      <SubTitle>Modo planificación y aprobación (HITL)</SubTitle>
      <Paragraph>
        El agente admite <strong>modo planificación</strong>: antes de tocar
        nada, te muestra su plan paso a paso en el Chat para que sepas qué va a
        hacer. Y usa <strong>aprobación humana (HITL)</strong>: cuando el plan
        cambia algo importante del equipo, te aparece una tarjeta con los pasos
        y dos botones, <strong>Confirmar y Ejecutar</strong> o{" "}
        <strong>Cancelar</strong>. Nada se ejecuta sin tu “sí”. Con el
        interruptor <strong>Modo Autónomo</strong> (solo STAFF y ADMIN) el
        agente actúa sin pedir permiso, salvo en acciones peligrosas, que
        siempre requieren tu aprobación.
      </Paragraph>

      <SubTitle>Los ayudantes (subagentes)</SubTitle>
      <SimpleTable
        headers={["Ayudante", "Qué sabe hacer", "Herramientas"]}
        rows={[
          [
            <InlineCode key="pt">packet_tracer_specialist</InlineCode>,
            "Arma y revisa redes de práctica en Cisco Packet Tracer: agrega equipos, conecta cables, pone direcciones IP y prueba si hay conexión.",
            "44",
          ],
          [
            <InlineCode key="gns3">gns3_specialist</InlineCode>,
            "Arma laboratorios en GNS3: crea proyectos, agrega equipos, los enciende o apaga y guarda copias (snapshots).",
            "44",
          ],
          [
            <InlineCode key="ssh">ssh_specialist</InlineCode>,
            "Habla con equipos reales por SSH (conexión segura): revisa cómo están y les aplica cambios.",
            "10",
          ],
          [
            <InlineCode key="telnet">telnet_specialist</InlineCode>,
            "Habla con equipos viejos por Telnet para revisarlos y configurarlos.",
            "10",
          ],
          [
            <InlineCode key="serial">serial_specialist</InlineCode>,
            "Habla con equipos por cable físico (puerto serie) cuando no hay red, comando por comando.",
            "10",
          ],
          [
            <InlineCode key="know">knowledge_specialist</InlineCode>,
            "Busca respuestas en tus documentos y, si no están ahí, en internet.",
            "4",
          ],
          [
            <InlineCode key="admin">system_admin_specialist</InlineCode>,
            "Cuida la propia aplicación: tareas programadas, lista de equipos, números del sistema y manejo de skills.",
            "17 (12 + 5 de skills)",
          ],
          [
            <InlineCode key="gen">general-purpose</InlineCode>,
            "El comodín: atiende trabajos mezclados o que necesitan varios pasos.",
            "Las que necesite",
          ],
        ]}
      />
      <Paragraph>
        Las cantidades son con rol ADMIN o STAFF. Con rol USER cada ayudante
        muestra menos herramientas.
      </Paragraph>

    </div>
  );
}
