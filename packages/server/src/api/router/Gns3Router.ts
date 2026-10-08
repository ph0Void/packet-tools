import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { Gns3Client } from "@/client/Gns3Client";
import { Role } from "@/prisma/generated/enums";
import { authMiddleware } from "@/middleware/auth.middleware";
import { requireRoles } from "@/middleware/role.middleware";

const router = Router();

const GNS3_FILES_DIR = path.resolve(process.cwd(), "uploads", "gns3");

const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/;
const ALLOWED_EXTENSIONS = new Set([
  ".gns3project",
  ".pcap",
  ".svg",
  ".zip",
  ".gns3",
]);

function mapNode(node: any) {
  return {
    node_id: node?.node_id ?? null,
    name: node?.name ?? null,
    node_type: node?.node_type ?? null,
    status: node?.status ?? null,
    x: node?.x ?? null,
    y: node?.y ?? null,
    console_host: node?.console_host ?? null,
    console: node?.console ?? null,
    console_type: node?.console_type ?? null,
  };
}

function mapLink(link: any) {
  const endpoints = (Array.isArray(link?.nodes) ? link.nodes : []).map(
    (endpoint: any) => ({
      node_id: endpoint?.node_id ?? null,
      adapter_number: endpoint?.adapter_number ?? null,
      port_number: endpoint?.port_number ?? null,
    }),
  );
  if (endpoints.length < 2) return null;

  const mapped: Record<string, any> = {
    link_id: link?.link_id ?? null,
    nodes: endpoints,
  };

  if (link?.filters !== undefined) mapped.filters = link.filters;
  if (link?.capturing !== undefined) mapped.capturing = link.capturing;
  return mapped;
}

router.use(authMiddleware);

router.get("/projects", requireRoles(Role.ADMIN, Role.STAFF), async (_req, res, next) => {
  try {
    const client = await Gns3Client.forRequest();
    const projects = (await client.getProjects()) ?? [];

    const data = (Array.isArray(projects) ? projects : [])
      .map((project: any) => ({
        project_id: project?.project_id ?? null,
        name: project?.name ?? null,
        status: project?.status ?? null,
        filename: project?.filename ?? null,
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

    return res.json({
      success: true,
      message: "Proyectos GNS3 obtenidos correctamente.",
      data,
    });
  } catch (error) {
    return next(error);
  }
});

router.get(
  "/projects/:projectId/topology",
  requireRoles(Role.ADMIN, Role.STAFF),
  async (req, res, next) => {
    const projectId = String(req.params.projectId ?? "").trim();
    try {
      const client = await Gns3Client.forRequest();
      const [project, rawNodes, rawLinks] = await Promise.all([
        client.getProject(projectId),
        client.getNodes(projectId),
        client.getLinks(projectId),
      ]);

      const nodes = (Array.isArray(rawNodes) ? rawNodes : []).map(mapNode);
      const links = (Array.isArray(rawLinks) ? rawLinks : []).flatMap((link: any) => {
        const mapped = mapLink(link);
        return mapped ? [mapped] : [];
      });

      return res.json({
        success: true,
        message: "Topología del proyecto GNS3 obtenida correctamente.",
        data: {
          project: {
            project_id: project?.project_id ?? null,
            name: project?.name ?? null,
            status: project?.status ?? null,
          },
          nodes,
          links,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      if (detail.includes("404")) {
        return res.status(404).json({
          success: false,
          message: "Proyecto GNS3 no encontrado",
          data: null,
        });
      }
      return next(error);
    }
  },
);

router.get(
  "/files/:fileName",
  requireRoles(Role.ADMIN, Role.STAFF),
  async (req, res, next) => {
    try {
      const fileName = String(req.params.fileName ?? "");
      const extension = path.extname(fileName).toLowerCase();
      if (!SAFE_FILE_NAME.test(fileName) || !ALLOWED_EXTENSIONS.has(extension)) {
        return res.status(400).json({
          success: false,
          message: "Nombre de archivo no permitido.",
          data: null,
        });
      }

      const fullPath = path.resolve(GNS3_FILES_DIR, fileName);
      if (!fullPath.startsWith(GNS3_FILES_DIR + path.sep)) {
        return res.status(400).json({
          success: false,
          message: "Nombre de archivo no permitido.",
          data: null,
        });
      }

      try {
        await fs.access(fullPath);
      } catch {
        return res.status(404).json({
          success: false,
          message: "Archivo no encontrado.",
          data: null,
        });
      }

      return res.download(fullPath);
    } catch (error) {
      return next(error);
    }
  },
);

export default router;
