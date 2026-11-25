"use client";

import Link from "next/link";
import { useSignOut } from "@/features/auth/use-sign-out";
import { useMe } from "@/lib/queries";

const linkStyle =
  "inline-flex min-h-11 shrink-0 items-center text-[15px] font-medium text-muted-foreground hover:text-foreground";

/** The console header's account side: who's signed in, the way back to the app and signing out. */
export function OpsAccount() {
  const { data: me } = useMe();
  const signOut = useSignOut();
  return (
    <div className="ml-auto flex min-w-0 items-center gap-4">
      {me && (
        <span className="hidden max-w-64 truncate text-sm text-muted-foreground sm:block">{me.user.email}</span>
      )}
      {/* Only staff who run a business too: without one, the app would just send them to set one up. */}
      {me?.tenant && (
        <Link href="/dashboard" className={linkStyle}>
          Back to the app
        </Link>
      )}
      <button type="button" onClick={signOut} className={linkStyle}>
        Sign out
      </button>
    </div>
  );
}
