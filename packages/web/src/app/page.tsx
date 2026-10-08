import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";

export const dynamic = "force-dynamic";

export default async function PageHome() {
  const user = await getSessionUser();
  redirect(user ? "/dashboard" : "/auth");
}
