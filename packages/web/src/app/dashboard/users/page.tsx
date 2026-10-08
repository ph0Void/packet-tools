import { redirect } from "next/navigation";
import { getSessionUser } from "@/action/SecureAction";
import { getAllUsers } from "@/service/UserService";
import TableUserWrapper from "@/component/user/TableUserWrapper";
import type { UserTypes } from "@/types/User";

export const metadata = {
  title: "Packet Tools - Usuarios",
  description: "Directorio de operadores del NOC",
};

interface PageProps {
  searchParams: Promise<{ page?: string; limit?: string }>;
}

const DEFAULT_PAGE_SIZE = 10;

export default async function UserPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/auth");

  const params = await searchParams;
  const currentPage = Number(params.page) || 1;
  const currentLimit = Number(params.limit) || DEFAULT_PAGE_SIZE;

  const result = await getAllUsers();

  const allUsers: UserTypes[] =
    result.success && result.data
      ? result.data.map((u) => ({
          id: u.id,
          username: u.username,
          role: u.role,
          createAt: u.createdAt,
        }))
      : [];

  const totalItems = allUsers.length;
  const totalPages = Math.ceil(totalItems / currentLimit) || 1;
  const start = (currentPage - 1) * currentLimit;
  const users = allUsers.slice(start, start + currentLimit);

  return (
    <div className="space-y-6 text-foreground p-1">
      <TableUserWrapper
        initialUsers={users}
        pagination={{
          currentPage,
          totalPages,
          totalItems,
          limit: currentLimit,
        }}
        isAdmin={user.role === "ADMIN"}
      />
    </div>
  );
}
