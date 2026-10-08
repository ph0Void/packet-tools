import type { Metadata } from "next";
import Script from "next/script";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import SonnerToast from "@/component/ui/SonnerToast";

const archivo = Archivo({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Packet Tool",
  description: `Herramienta  Inteligente para automatizar y gestionar redes  compatible  con:
    - Simuladores : Cisco Packet Tracer, GNS3
    - Equipos Fisicos: Cisco , Huawei , Aruba, Juniper
    - Conexiones soportados: SSH, Telnet, Puerto Serial
  `,
};

const THEME_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem("ui-storage");var theme=null;if(raw){var parsed=JSON.parse(raw);if(parsed&&parsed.state&&(parsed.state.theme==="light"||parsed.state.theme==="dark")){theme=parsed.state.theme;}}var root=document.documentElement;if(theme==="light"){root.classList.remove("dark");}else{root.classList.add("dark");}}catch(e){}})();`;

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
      </head>
      <body className="min-h-full flex flex-col">
        {children}

        <SonnerToast />
      </body>
    </html>
  );
}
