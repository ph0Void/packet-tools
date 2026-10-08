import { getSessionUser } from "@/action/SecureAction";
import { getSkills, type Skill } from "@/service/SkillService";
import SkillsManager from "@/component/skills/SkillsManager";

export const metadata = {
  title: "Packet Tools - Skills",
  description:
    "Administración y gestión de playbooks para ampliar las capacidades del agente IA",
};

export default async function PageSkills() {
  const user = await getSessionUser();
  const role = user?.role;
  const canEdit = role === "ADMIN" || role === "STAFF";

  const canDelete = role === "ADMIN";

  const result = await getSkills();
  const skills: Skill[] =
    result.success && Array.isArray(result.data) ? result.data : [];

  return (
    <div className="space-y-6 p-4 text-foreground md:p-6">
      <SkillsManager
        initialSkills={skills}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
