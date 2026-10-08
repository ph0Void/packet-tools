"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import {
  Book,
  BookOpen,
  Eye,
  FileText,
  LibraryBig,
  Loader2,
  Search,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteDocumentAction,
  getDocumentsAction,
  uploadDocumentAction,
} from "@/action/KnowledgeBaseAction";
import type { KnowledgeDocument } from "@/service/KnowledgeBaseService";
import type { FormState } from "@/types/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md"];
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const initialState: FormState = { success: false, message: "" };

function mimeBadge(mime: string | null): { label: string; className: string } {
  switch (mime) {
    case "application/pdf":
      return {
        label: "PDF",
        className: "border-rose-500/40 text-rose-500 dark:text-rose-400",
      };
    case "text/markdown":
      return {
        label: "MD",
        className: "border-sky-500/40 text-sky-600 dark:text-sky-400",
      };
    case "text/plain":
      return {
        label: "TXT",
        className:
          "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
      };
    default:
      return { label: mime ? mime.slice(0, 12) : "FILE", className: "" };
  }
}

function validateClientFile(file: File): string | null {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return "Formato no permitido. Solo se aceptan archivos .pdf, .txt y .md.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "El archivo supera el límite de 25MB.";
  }
  return null;
}

interface KnowledgeBaseManagerProps {
  initialDocuments: KnowledgeDocument[];
  canManage: boolean;
}

export default function KnowledgeBaseManager({
  initialDocuments,
  canManage,
}: KnowledgeBaseManagerProps) {
  const router = useRouter();
  const [documents, setDocuments] =
    useState<KnowledgeDocument[]>(initialDocuments);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, formAction, isPending] = useActionState(
    uploadDocumentAction,
    initialState,
  );

  useEffect(() => {
    if (!isPending) {
      if (!state.message) return;
      let progressReset: ReturnType<typeof setTimeout> | undefined;
      const applyResult = setTimeout(() => {
        if (state.success) {
          toast.success(state.message || "Documento subido correctamente.");
          setSelectedFile(null);
          setSearchTerm("");
          if (fileInputRef.current) fileInputRef.current.value = "";
          void (async () => {
            const result = await getDocumentsAction();
            if (result.success && Array.isArray(result.data)) {
              setDocuments(result.data as KnowledgeDocument[]);
            }
          })();
          router.refresh();
        } else {
          toast.error(state.message);
        }
        setProgress(100);
        progressReset = setTimeout(() => setProgress(0), 1200);
      });
      return () => {
        clearTimeout(applyResult);
        if (progressReset !== undefined) clearTimeout(progressReset);
      };
    }

    queueMicrotask(() => setProgress((prev) => (prev === 0 ? 5 : prev)));
    const interval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 7, 90));
    }, 300);
    return () => clearInterval(interval);
  }, [state, isPending, router]);

  const handleFileSelection = (file: File | undefined | null) => {
    if (!file) return;
    const error = validateClientFile(file);
    if (error) {
      toast.error(error);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleValidateBeforeSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!isPending && selectedFile) {
      const error = validateClientFile(selectedFile);
      if (error) {
        e.preventDefault();
        toast.error(error);
      }
    }
  };

  const handleDelete = async (doc: KnowledgeDocument) => {
    if (
      !confirm(
        `¿Eliminar el documento "${doc.title}" de la base de conocimiento?`,
      )
    ) {
      return;
    }
    setDeletingId(doc.id);
    const result = await deleteDocumentAction(doc.id);
    setDeletingId(null);
    if (result.success) {
      toast.success(result.message || "Documento eliminado.");
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      router.refresh();
    } else {
      toast.error(result.message || "Error al eliminar el documento.");
    }
  };

  const filteredDocuments = documents.filter(
    (doc) =>
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (doc.description ?? "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="space-y-6">

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-border/40 bg-muted/30 p-4 md:p-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <LibraryBig className="h-5 w-5 text-primary" />
            Base de Conocimiento RAG
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            Documentos y manuales técnicos indexados vectorialmente para
            consulta agéntica.
          </p>
        </div>

      </div>

      {canManage && (
        <form
          action={formAction}
          onSubmit={handleValidateBeforeSubmit}
          className="rounded-xl border border-border bg-card p-4 md:p-6 shadow-sm space-y-4"
          encType="multipart/form-data"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                Subir documento
              </h2>
              <p className="text-xs text-muted-foreground">
                Archivos .pdf, .txt o .md de hasta 25MB. Quedarán indexados para
                RAG.
              </p>
            </div>
          </div>

          <label
            htmlFor="kb-file-input"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (fileInputRef.current && file) {
                const dt = new DataTransfer();
                dt.items.add(file);
                fileInputRef.current.files = dt.files;
              }
              handleFileSelection(file);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-all duration-200 ${
              dragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            <input
              ref={fileInputRef}
              id="kb-file-input"
              type="file"
              name="file"
              accept=".pdf,.txt,.md"
              className="sr-only"
              onChange={(e) => handleFileSelection(e.target.files?.[0])}
            />
            <UploadCloud className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              Arrastra un archivo aquí o haz clic para seleccionarlo
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedFile
                ? `Seleccionado: ${selectedFile.name} (${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)`
                : ".pdf · .txt · .md · máx 25MB"}
            </p>
          </label>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div className="space-y-2 flex-1">
              <label
                htmlFor="kb-title-input"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Título personalizado (opcional)
              </label>
              <Input
                id="kb-title-input"
                name="title"
                placeholder="Ej: Manual de comandos Cisco IOS 15"
              />
            </div>
            <Button
              type="submit"
              disabled={isPending || !selectedFile}
              className="gap-2 w-full sm:w-auto"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Subiendo e
                  indexando...
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" /> Subir Documento
                </>
              )}
            </Button>
          </div>

          {progress > 0 && (
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full rounded-full bg-muted overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </form>
      )}

      <section className="rounded-xl border border-border bg-card p-4 md:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">
                Documentos indexados
              </h2>
              <p className="text-xs text-muted-foreground">
                {canManage
                  ? "Gestiona los documentos disponibles para la IA."
                  : "Consulta los documentos disponibles para la IA."}
              </p>
            </div>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar documentos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Buscar documentos"
              className="pl-9 text-sm"
            />
          </div>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs font-semibold text-muted-foreground uppercase border-b border-border">
                <tr>
                  <th className="p-4">Título</th>
                  <th className="p-4">Tipo</th>
                  <th className="p-4">Fecha</th>
                  <th className="p-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredDocuments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="p-8 text-center text-muted-foreground"
                    >
                      <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                      {documents.length === 0
                        ? "No hay documentos en la base de conocimiento."
                        : "Sin resultados para la búsqueda."}
                    </td>
                  </tr>
                ) : (
                  filteredDocuments.map((doc) => {
                    const badge = mimeBadge(doc.description);
                    return (
                      <tr
                        key={doc.id}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="p-4 font-semibold text-foreground">
                          <span className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary shrink-0" />
                            {doc.title}
                          </span>
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className={badge.className}>
                            {badge.label}
                          </Badge>
                        </td>
                        <td className="p-4 text-xs font-mono text-muted-foreground">
                          {new Date(doc.createdAt).toLocaleDateString("es-ES")}
                        </td>
                        <td className="p-4 text-right space-x-1 whitespace-nowrap">
                          <Button size="icon" variant="ghost" asChild>
                            <a
                              href={`/api/data/${doc.id}/file`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Ver ${doc.title}`}
                            >
                              <Eye className="w-4 h-4" />
                            </a>
                          </Button>
                          {canManage && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10"
                              disabled={deletingId === doc.id}
                              aria-label={`Eliminar ${doc.title}`}
                              onClick={() => void handleDelete(doc)}
                            >
                              {deletingId === doc.id ? (
                                <Spinner />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
