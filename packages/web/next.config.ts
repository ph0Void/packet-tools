import type { NextConfig } from "next";
import path from "node:path";

// COREGIR
const nextConfig: NextConfig = {
  reactCompiler: true,
  // Build autocontenido para el instalador Electron: .next/standalone incluye
  // server.js + dependencias trazadas. La raíz de trazado es el monorepo
  // porque node_modules está hoisteado en la raíz.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  env: {
    //NEXT_PUBLIC_BACKEND_URL: `${process.env.NEXT_PUBLIC_API_URL}:${process.env.SERVER_PORT}`,
    NEXT_PUBLIC_BACKEND_URL: `${process.env.NEXT_PUBLIC_API_URL}`,
    VERSION: process.env.NEXT_PUBLIC_VERSION || process.env.VERSION || "1.2.0",
  },
  // output: "export", // para producción
  async rewrites() {
    //const serverPort = process.env.SERVER_PORT ?? "7531";
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:7531";

    return [
      {
        source: "/api/:path*",
        //destination: `${apiUrl}:${serverPort}/api/:path*`,
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
