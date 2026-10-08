import { redirect } from "next/navigation";

import { getSessionUser } from "@/action/SecureAction";
import { TerminalWorkspace } from "@/component/terminal/TerminalWorkspace";

export default async function PageTerminal() {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  return <TerminalWorkspace role={user.role} />;
}
