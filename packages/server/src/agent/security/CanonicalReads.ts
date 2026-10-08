export interface LecturaCanonica {

  tema: string;

  comando: string;

  nota?: string;
}

export interface GuiaDeVendor {

  label: string;

  alias: string[];
  lecturas: LecturaCanonica[];
}

const CISCO_ARUBA: GuiaDeVendor = {
  label: "Cisco IOS / IOS-XE / NX-OS · ArubaOS",
  alias: ["cisco", "ios", "iosxe", "ios-xe", "nxos", "nx-os", "packet tracer", "aruba", "arubaos", "arubaoscx"],
  lecturas: [
    {
      tema: "configuracion completa",
      comando: "show running-config",
      nota: "En NX-OS: show running-config | include <seccion>. En Packet Tracer es la lectura de referencia.",
    },
    {
      tema: "direcciones de interfaz",
      comando: "show ip interface brief",
    },
    {
      tema: "tabla de rutas",
      comando: "show ip route",
    },
    {
      tema: "VLANs (switches)",
      comando: "show vlan brief",
      nota: "show interfaces status para el estado de los puertos.",
    },
    {
      tema: "uso de CPU y memoria",
      comando: "show processes cpu sorted | head 10",
      nota: "show memory summarize para el detalle de memoria.",
    },
    {
      tema: "version e inventario",
      comando: "show version",
    },
    {
      tema: "vecinos OSPF / vecinos de enrutamiento",
      comando: "show ip ospf neighbor",
      nota: "show cdp neighbors para el vecindario de capa 2.",
    },
  ],
};

const HUAWEI: GuiaDeVendor = {
  label: "Huawei VRP",
  alias: ["huawei", "vrp", "cloudengine"],
  lecturas: [
    {
      tema: "configuracion completa",
      comando: "display current-configuration",
      nota: "Equivalente por secciones: display current-configuration interface GigabitEthernet 0/0/1.",
    },
    {
      tema: "direcciones de interfaz",
      comando: "display ip interface brief",
    },
    {
      tema: "tabla de rutas",
      comando: "display ip routing-table",
    },
    {
      tema: "uso de CPU y memoria",
      comando: "display cpu-usage",
      nota: "display memory-usage para la memoria.",
    },
    {
      tema: "version e inventario",
      comando: "display version",
    },
    {
      tema: "vecinos OSPF",
      comando: "display ospf peer brief",
    },
  ],
};

const JUNOS: GuiaDeVendor = {
  label: "Juniper JunOS",
  alias: ["junos", "juniper", "juniper netscreen"],
  lecturas: [
    {
      tema: "configuracion completa",
      comando: "show configuration | display set",
      nota: "show configuration | display set | match <clave> acota a una seccion.",
    },
    {
      tema: "direcciones de interfaz",
      comando: "show interfaces terse",
    },
    {
      tema: "tabla de rutas",
      comando: "show route",
    },
    {
      tema: "uso de CPU y memoria",
      comando: "show system resources",
    },
    {
      tema: "version e inventario",
      comando: "show version",
    },
    {
      tema: "vecinos OSPF",
      comando: "show ospf neighbor",
    },
  ],
};

const VYOS: GuiaDeVendor = {
  label: "VyOS / EdgeOS",
  alias: ["vyos", "edgeos", "vyatta"],
  lecturas: [
    {
      tema: "configuracion completa",
      comando: "show configuration commands",
    },
    {
      tema: "direcciones de interfaz",
      comando: "show interface",
    },
    {
      tema: "tabla de rutas",
      comando: "show ip route",
    },
    {
      tema: "uso de CPU y memoria",
      comando: "show system memory",
      nota: "show system statistics para CPU y agregado.",
    },
    {
      tema: "version",
      comando: "show version",
    },
  ],
};

const MIKROTIK: GuiaDeVendor = {
  label: "MikroTik RouterOS",
  alias: ["mikrotik", "routeros", "router board", "routerboard", "mikrotik routeros"],
  lecturas: [
    {
      tema: "configuracion completa (export)",
      comando: "/export",
      nota: "Devuelve la configuracion en script. NO es un comando de solo lectura por filtros: no anadas 'file=' ni lo descargues si el usuario no lo pide.",
    },
    {
      tema: "configuracion guardada",
      comando: "/system script print",
      nota: "Las claves estan en /user; no las imprimas si el usuario no lo pide.",
    },
    {
      tema: "CPU y memoria",
      comando: "/system resource print",
    },
    {
      tema: "direcciones de interfaz",
      comando: "/ip address print",
    },
    {
      tema: "tabla de rutas",
      comando: "/ip route print",
    },
    {
      tema: "reglas de filtrado (firewall)",
      comando: "/ip firewall filter print",
      nota: "/ip firewall nat print para la traduccion de direcciones.",
    },
    {
      tema: "interfaces",
      comando: "/interface print",
    },
    {
      tema: "vecinos y wireless",
      comando: "/ip neighbor print",
    },
  ],
};

const FORTIOS: GuiaDeVendor = {
  label: "FortiOS",
  alias: ["fortios", "fortigate", "forti", "fortinet"],
  lecturas: [
    {
      tema: "estado y configuracion resumida",
      comando: "get system status",
      nota: "show full-config para la configuracion completa.",
    },
    {
      tema: "configuracion completa",
      comando: "show full-config",
    },
    {
      tema: "tabla de rutas",
      comando: "get router info routing-table all",
    },
    {
      tema: "direcciones de interfaz",
      comando: "get system interface physical",
    },
    {
      tema: "uso de CPU y memoria",
      comando: "diagnose sys performance top",
      nota: "get system performance status para el resumen.",
    },
  ],
};

const GENERICO: GuiaDeVendor = {
  label: "CLI no identificado",
  alias: ["generico", "conservador", "desconocido", "unknown", "otro"],
  lecturas: [
    {
      tema: "configuracion completa",
      comando: "el equivalente del fabricante (no hay lista cerrada por marca)",
      nota: "Si no reconoces el CLI: pregunta al usuario o consulta 'search_knowledge_base' con el nombre exacto del equipo. No improvises comandos.",
    },
    {
      tema: "estado y recursos",
      comando: "el equivalente del fabricante (no hay lista cerrada por marca)",
    },
  ],
};

export const GUIAS_DE_VENDOR: readonly GuiaDeVendor[] = [
  CISCO_ARUBA,
  HUAWEI,
  JUNOS,
  VYOS,
  MIKROTIK,
  FORTIOS,
  GENERICO,
];

function normaliza(valor: string): string {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolverGuiaDeVendor(vendor?: string | null): GuiaDeVendor | null {
  const bruto = String(vendor ?? "").trim();
  if (!bruto) return null;
  const normalizado = normaliza(bruto);
  if (!normalizado) return null;
  for (const guia of GUIAS_DE_VENDOR) {
    if (guia.alias.some((alias) => normalizado === alias)) return guia;
  }

  for (const guia of GUIAS_DE_VENDOR) {
    const hit = guia.alias.find(
      (alias) => normalizado.includes(alias) || alias.includes(normalizado),
    );
    if (hit) return guia;
  }
  return null;
}

function formateaLecturas(lecturas: LecturaCanonica[]): string {
  return lecturas
    .map((lectura) => {
      const linea = `- ${lectura.tema}: ${lectura.comando}`;
      return lectura.nota ? `${linea} (${lectura.nota})` : linea;
    })
    .join("\n");
}

export function formateaGuia(guia: GuiaDeVendor): string {
  return `### ${guia.label}\n${formateaLecturas(guia.lecturas)}`;
}

export function guiaDeLecturaCanonica(vendor?: string | null): string {
  const guia = resolverGuiaDeVendor(vendor);
  if (guia) {
    return [
      `Comando canonico de lectura (solo lectura) para ${guia.label}:`,
      formateaLecturas(guia.lecturas),
      "Usa el comando del tema que pide la pregunta, el mas completo que exista para ese tema: una sola lectura, no un recorrido de menus.",
    ].join("\n");
  }
  const conocido = vendor ? `'${String(vendor).trim()}'` : "el vendor indicado";
  return [
    `No hay guia especifica para ${conocido}. Estos son los comandos canonicos de solo lectura por CLI:`,
    ...GUIAS_DE_VENDOR.map(formateaGuia),
    "Elige el bloque de tu equipo y usa el comando del tema que se pregunta. Si tu CLI no esta en la lista, pregunta al usuario o consulta 'search_knowledge_base' con el modelo exacto; no improvises.",
  ].join("\n");
}
