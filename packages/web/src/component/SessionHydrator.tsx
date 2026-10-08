"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import type { SessionUser } from "@/action/SecureAction";

interface SessionHydratorProps {
  user: SessionUser;
}

export default function SessionHydrator({ user }: SessionHydratorProps) {
  const setUser = useAuthStore((state) => state.setUser);

  useEffect(() => {
    setUser(user);
  }, [user, setUser]);

  return null;
}
