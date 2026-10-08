import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import NavBar from "@/component/ui/NavBar";
import SideBar from "@/component/ui/SideBar";
import SonnerToast from "@/component/ui/SonnerToast";
import SessionHydrator from "@/component/SessionHydrator";
import { ChatProvider } from "@/context/ChatContext";
import { GlobalChatPanel } from "@/component/chat/GlobalChatPanel";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth?expired=true");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SessionHydrator user={user} />
      <ChatProvider>
        <SideBar />

        <div className="flex min-w-0 flex-1 flex-col">
          <NavBar />

          <div className="flex flex-1 overflow-hidden">
            <main className="custom-scrollbar flex-1 overflow-y-auto p-4 md:p-6">
              {children}
            </main>

            <GlobalChatPanel />
          </div>
        </div>
      </ChatProvider>
      <SonnerToast />
    </div>
  );
}
