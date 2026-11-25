"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

/** Ends the session, drops everything cached for this account and goes to sign-in. */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async () => {
    await signOut();
    queryClient.clear();
    router.replace("/sign-in");
  };
}
