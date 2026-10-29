import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-muted-foreground">Page not found</p>
      <h1 className="font-display text-3xl font-semibold">There&apos;s nothing here</h1>
      <p className="max-w-sm text-muted-foreground">The link may be old or mistyped.</p>
      <Button nativeButton={false} render={<Link href="/dashboard" />}>
        Go to Today
      </Button>
    </main>
  );
}
