import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import ChatPrincipalWraper from "@/component/chat/ChatPrincipalWraper";

export const metadata = {
  title: "Packet Tools - Chat",
  description:
    "Chat agéntico multimodal, donde tu asistente virtual te ayudará en tu trabajo con la configuración de dispositivos, comandos, logs y alertas",
};

export default async function ChatPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  return (
    <div className="flex h-full w-full min-h-0">
      <ChatPrincipalWraper />
    </div>
  );
}
