import { getSessionUser } from "@/action/SecureAction";
import {
  getDocuments,
  type KnowledgeDocument,
} from "@/service/KnowledgeBaseService";
import KnowledgeBaseManager from "@/component/data/KnowledgeBaseManager";

export const metadata = {
  title: "Packet Tools - Base de Conocimiento RAG",
  description: "Gestión de documentos y manuales técnicos para la IA",
};

export default async function PageDataKnowledge() {
  const user = await getSessionUser();
  const canManage = user?.role === "ADMIN" || user?.role === "STAFF";

  const result = await getDocuments();
  const documents: KnowledgeDocument[] =
    result.success && Array.isArray(result.data) ? result.data : [];

  return (
    <div className="space-y-6 text-foreground p-1">
      <KnowledgeBaseManager
        initialDocuments={documents}
        canManage={canManage}
      />
    </div>
  );
}
