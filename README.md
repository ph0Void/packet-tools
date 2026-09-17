# 🤖 Packet Tools

**Packet Tools** es una plataforma creada para facilitar la administración, configuración y aprendizaje de redes de una manera más sencilla.

Este proyecto nació con la idea de reunir en un solo lugar diferentes herramientas para trabajar con redes, permitiendo conectar **simuladores, equipos reales y asistentes de Inteligencia Artificial**.

La plataforma permite interactuar con la red utilizando comandos tradicionales o simplemente escribiendo lo que necesitas hacer en **lenguaje natural**.

📺 **Mira el proyecto en acción:**

https://github.com/user-attachments/assets/a1c13731-7216-4157-b088-6335641caca7

---

## 🚀 ¿Qué puedes hacer con Packet Tools?

### 🧠 Asistente de Inteligencia Artificial

Integra asistentes de IA capaces de entender instrucciones escritas en lenguaje natural.

Por ejemplo:

> "Crea una red con dos switches y cuatro computadoras."

El asistente puede interpretar la solicitud y ayudarte a realizar las acciones necesarias.

También puedes utilizar la IA para consultar información, revisar configuraciones y trabajar con tus dispositivos de red.

---

### 🌐 Trabajar con redes reales

Packet Tools permite conectarse a equipos de red mediante diferentes formas de conexión.

Puedes abrir una terminal desde la plataforma y trabajar directamente con dispositivos compatibles.

Esto permite utilizar la aplicación tanto para **prácticas y laboratorios** como para trabajar con equipos reales.

---

### 🖥️ Cisco Packet Tracer

Puedes conectar Packet Tools con **Cisco Packet Tracer** para crear y administrar topologías.

La plataforma puede ayudarte a:

* Crear dispositivos.
* Crear conexiones entre dispositivos.
* Configurar equipos.
* Modificar una topología.
* Consultar información de los dispositivos.
* Simular diferentes situaciones de red.

De esta manera, muchas tareas que normalmente realizarías manualmente pueden ser realizadas mediante instrucciones.

---

### 🔬 GNS3

También es compatible con **GNS3**, permitiendo trabajar con laboratorios de redes virtualizados.

Puedes crear proyectos, agregar dispositivos y establecer conexiones desde la plataforma.

---

### 💻 Terminal integrada

Packet Tools incluye una terminal desde la cual puedes trabajar con tus dispositivos.

Permite utilizar conexiones como:

* SSH
* Telnet
* Puerto serial

La terminal puede ser utilizada directamente por el usuario o por el asistente de IA.

---

### 🗺️ Creación y visualización de topologías

La plataforma cuenta con un espacio visual para trabajar con topologías de red.

Puedes visualizar tus dispositivos, conexiones e información relacionada con cada equipo.

Las topologías también pueden guardarse para continuar trabajando con ellas posteriormente.

---

### 📚 Base de conocimiento

Puedes agregar documentos para que la IA pueda utilizarlos como fuente de información.

Esto permite crear una pequeña base de conocimiento para consultar documentación, manuales, configuraciones y otros archivos relacionados con tus redes.

---

### 🔎 Búsqueda de información

El asistente también puede utilizar búsquedas en Internet para consultar información que pueda ser necesaria durante una tarea.

Esto resulta útil para consultar documentación, comandos o información actualizada.

---

### ⏰ Automatización

Packet Tools permite crear tareas que pueden ejecutarse de forma programada.

Por ejemplo, puedes establecer tareas para realizar determinadas acciones sobre una topología o dispositivo en horarios específicos.

---

### 📋 Historial y registros

Las acciones realizadas dentro de la plataforma pueden quedar registradas.

Esto permite revisar posteriormente:

* Comandos ejecutados.
* Acciones realizadas por la IA.
* Tareas programadas.
* Cambios realizados.
* Alertas generadas.

---

### 🔐 Seguridad

La plataforma cuenta con diferentes niveles de usuario y mecanismos de seguridad.

Las acciones que pueden afectar de manera importante a un dispositivo cuentan con controles para evitar que se ejecuten accidentalmente.

Algunas operaciones requieren una confirmación antes de ser ejecutadas.

---

## ✨ Características

* 🤖 Asistente de IA para trabajar con redes.
* 🌐 Administración de dispositivos de red.
* 🖥️ Integración con Cisco Packet Tracer.
* 🔬 Integración con GNS3.
* 💻 Terminal SSH, Telnet y Serial.
* 🗺️ Visualización y administración de topologías.
* 📚 Base de conocimiento para la IA.
* 🔎 Búsqueda de información.
* ⏰ Tareas programadas.
* 📋 Historial de acciones y registros.
* 🔐 Sistema de usuarios y permisos.
* 🖼️ Interfaz web para administrar todo desde un solo lugar.
* 🖥️ Aplicación de escritorio para Windows y Linux.

---

## 🔌 Compatible con

Packet Tools puede trabajar con diferentes entornos y dispositivos:

### Simuladores

* Cisco Packet Tracer
* GNS3

### Conexiones

* SSH
* Telnet
* Puerto Serial

### Fabricantes

* Cisco
* Huawei
* Aruba
* MikroTik
* Otros dispositivos compatibles con las conexiones disponibles.

### Inteligencia Artificial

La plataforma permite trabajar con diferentes proveedores de modelos de IA, incluyendo modelos en la nube y modelos que pueden ejecutarse localmente.

Entre ellos:

* OpenAI
* Google Gemini
* Anthropic
* OpenRouter
* Ollama
* LM Studio

---

## 👤 Usuario por defecto

Al iniciar la aplicación por primera vez puedes ingresar con el siguiente usuario:

| Usuario | Contraseña |
| ------- | ---------- |
| `admin` | `admin123` |

Este usuario tiene permisos de **administrador**.

> ⚠️ Por seguridad, se recomienda cambiar la contraseña después del primer inicio de sesión, especialmente si la aplicación será utilizada fuera de tu equipo.

---

## 🚀 Inicio rápido

### 1. Clonar el proyecto

```bash
git clone https://github.com/ph0Void/packet-tools.git
cd packet-tools
```

### 2. Instalar y preparar el proyecto

```bash
npm run init
```

### 3. Preparar la base de datos

```bash
npm run migrate
npm run generate
npm run seed
```

### 4. Iniciar la aplicación

```bash
npm run dev
```

Una vez iniciada, podrás acceder al panel desde:

**http://localhost:3090**

El servidor estará disponible en:

**http://localhost:7531**

---

## 🖥️ Aplicación de escritorio

Packet Tools también puede utilizarse como una aplicación de escritorio.

Esto permite instalar la plataforma en tu computadora sin tener que configurar manualmente todos los servicios necesarios.

Actualmente se pueden generar instaladores para:

* 🪟 Windows
* 🐧 Linux

---

## 🎯 ¿Para quién está pensado?

Packet Tools está pensado principalmente para:

* 👨‍💻 Desarrolladores interesados en redes.
* 🌐 Administradores de redes.
* 🎓 Estudiantes de redes y sistemas.
* 🧪 Personas que realizan laboratorios con Cisco Packet Tracer o GNS3.
* 🤖 Personas interesadas en utilizar IA para automatizar tareas de red.
* 🏢 Equipos que necesitan centralizar tareas relacionadas con infraestructura de red.

---

## 💡 La idea detrás del proyecto

Packet Tools nació con una idea sencilla:

> **Hacer que trabajar con redes sea más fácil.**

En lugar de utilizar diferentes herramientas para administrar dispositivos, crear laboratorios, revisar configuraciones, consultar documentación y utilizar Inteligencia Artificial, el proyecto busca reunir estas funciones en un mismo lugar.

La intención es que puedas **describir lo que quieres hacer y trabajar con tu red de una manera más natural, rápida y organizada.**

---

## 🔮 Próximamente

El proyecto continúa en desarrollo y se planean nuevas funciones para mejorar la automatización, ampliar la compatibilidad con dispositivos y protocolos, mejorar el uso de agentes de IA y facilitar la creación y administración de laboratorios de red.

---

## 🤝 Contribuciones

Las contribuciones son bienvenidas.

Si encuentras un error, tienes una idea o quieres proponer una mejora, puedes abrir un **Issue** o enviar un **Pull Request**.

Repositorio:

https://github.com/ph0Void/packet-tools

---

## 📄 Licencia

Este proyecto está publicado bajo la licencia **ISC**.

---

## 👨‍💻 Autor

Desarrollado por **ph0Void**.
