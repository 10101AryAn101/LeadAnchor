"use client";

import type { MeResponse } from "@leadanchor/contracts";
import { IconDots, IconSearch } from "@tabler/icons-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, Suspense, useEffect } from "react";
import { toast } from "sonner";
import { Logo, LogoMark } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useRealtime } from "@/hooks/use-realtime";
import { ApiError } from "@/lib/api";
import { useLeads, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CommandMenu, openCommandMenu } from "./command-menu";
import { type NavItem, PRIMARY_NAV, SECONDARY_NAV } from "./nav-items";
import { NotificationsButton } from "./notifications-button";
import { TrackingNumber } from "./tracking-number";
import { UserMenu } from "./user-menu";

const isActive = (pathname: string | null, href: string) => pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));

/** Lead detail is a "pushed" screen: it swaps the tab bar for its own sticky action bar. */
const isPushedScreen = (pathname: string) => /^\/leads\/[^/]+$/.test(pathname);

/**
 * The owner app frame. The page (children) always renders right away, so every
 * navigation shows UI instantly and pages fetch their data in parallel with the
 * session. Only the pieces that need the session (business name, phone line, user
 * menu) show placeholders while it loads, and the pieces that read the URL (active
 * tab) sit in their own Suspense boundaries — Next.js prerenders everything else.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  // Signed in but no business yet: hold the page while we redirect to onboarding.
  const needsOnboarding = Boolean(me.data && !me.data.tenant);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <Sidebar me={me.data} />
      <div className="flex min-w-0 flex-col">
        <MobileHeader me={me.data} />
        <DesktopTopBar />
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-2 lg:pb-16">
          {needsOnboarding ? <MainSkeleton /> : children}
        </main>
      </div>
      <Suspense fallback={null}>
        <BottomTabs />
      </Suspense>
      <CommandMenu />
      <SessionRedirect error={me.error} needsOnboarding={needsOnboarding} />
      {me.data?.tenant && <LiveUpdates />}
    </div>
  );
}

/** Sends signed-out users to sign-in and new users to onboarding. */
function SessionRedirect({ error, needsOnboarding }: { error: Error | null; needsOnboarding: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      router.replace(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
    } else if (needsOnboarding) {
      router.replace("/onboarding");
    }
  }, [error, needsOnboarding, router]);
  return null;
}

/** Keeps every screen live and turns owner alerts into toasts with a jump link. */
function LiveUpdates() {
  const router = useRouter();
  useRealtime((event) =>
    toast(event.title, {
      description: event.body,
      action: event.leadId ? { label: "Open", onClick: () => router.push(`/leads/${event.leadId}`) } : undefined,
    }),
  );
  return null;
}

function useWaitingCount() {
  const { data: leads } = useLeads();
  return leads?.filter((lead) => lead.needsCallback && lead.stage === "new").length ?? 0;
}

/* ── Navigation (reads the URL, so it renders inside Suspense) ──────────── */

function SidebarLink({ item, pathname, count }: { item: NavItem; pathname: string | null; count?: number }) {
  const active = isActive(pathname, item.href);
  const Icon = active && item.activeIcon ? item.activeIcon : item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-11 items-center gap-3 rounded-md px-3 font-medium transition-colors",
        active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-5", active && "text-primary")} stroke={1.75} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge === "dev" && (
        <Badge variant="outline" className="text-xs">
          Dev
        </Badge>
      )}
      {count ? (
        <span className="tabular rounded-full bg-signal px-2 text-[13px] leading-6 font-semibold text-signal-foreground">{count}</span>
      ) : null}
    </Link>
  );
}

function NavList({ items, pathname, label, showWaiting = false }: { items: NavItem[]; pathname: string | null; label: string; showWaiting?: boolean }) {
  const waiting = useWaitingCount();
  return (
    <nav className="flex flex-col gap-0.5" aria-label={label}>
      {items.map((item) => (
        <SidebarLink key={item.href} item={item} pathname={pathname} count={showWaiting && item.href === "/leads" ? waiting : undefined} />
      ))}
    </nav>
  );
}

/** Highlights the current page. While the URL isn't known yet, the same links render without a highlight. */
function Nav(props: { items: NavItem[]; label: string; showWaiting?: boolean }) {
  return (
    <Suspense fallback={<NavList {...props} pathname={null} />}>
      <NavWithPath {...props} />
    </Suspense>
  );
}

function NavWithPath(props: { items: NavItem[]; label: string; showWaiting?: boolean }) {
  return <NavList {...props} pathname={usePathname()} />;
}

/* ── Desktop ─────────────────────────────────────────────────────────────── */

function Sidebar({ me }: { me: MeResponse | undefined }) {
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
      <Link href="/dashboard" className="px-2" aria-label="LeadAnchor home">
        <Logo />
      </Link>
      <div className="mt-6 space-y-3">
        {me?.tenant ? (
          <>
            <p className="truncate px-2 font-semibold">{me.tenant.name}</p>
            <TrackingNumber e164={me.tenant.trackingNumber} />
          </>
        ) : (
          <>
            <Skeleton className="mx-2 h-5 w-40" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </>
        )}
      </div>
      <div className="mt-6">
        <Nav items={PRIMARY_NAV} label="Main" showWaiting />
      </div>
      <div className="mt-6 mb-1.5 px-3 text-sm text-muted-foreground">Business</div>
      <Nav items={SECONDARY_NAV} label="Business" />
      <div className="mt-auto border-t border-sidebar-border pt-3">
        {me?.tenant ? <UserMenu name={me.user.name} email={me.user.email} business={me.tenant.name} /> : <Skeleton className="h-12 w-full" />}
      </div>
    </aside>
  );
}

function DesktopTopBar() {
  return (
    <div className="sticky top-0 z-30 hidden items-center justify-end gap-2 bg-background/95 px-10 py-3 lg:flex">
      <Button variant="outline" className="w-80 justify-start gap-2 rounded-full font-normal text-muted-foreground" onClick={openCommandMenu}>
        <IconSearch className="size-[18px]" />
        <span className="flex-1 text-left">Search customers and jobs</span>
        <Kbd>Ctrl K</Kbd>
      </Button>
      <NotificationsButton />
    </div>
  );
}

/* ── Phones ──────────────────────────────────────────────────────────────── */

function MobileHeader({ me }: { me: MeResponse | undefined }) {
  return (
    <header className="pt-safe sticky top-0 z-30 border-b bg-background/95 lg:hidden">
      <div className="flex h-14 items-center gap-2 pr-2 pl-4">
        <LogoMark className="size-8" />
        <span className="min-w-0 flex-1 truncate pl-1 font-display text-[17px] font-semibold">
          {me?.tenant ? me.tenant.name : <Skeleton className="h-5 w-36" />}
        </span>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Search" onClick={openCommandMenu}>
          <IconSearch className="size-[22px]" stroke={1.75} />
        </Button>
        <NotificationsButton />
        <Sheet>
          <SheetTrigger render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="More" />}>
            <IconDots className="size-[22px]" />
          </SheetTrigger>
          <SheetContent side="right" className="w-[88vw] max-w-sm gap-0 p-0">
            <SheetHeader className="border-b p-5">
              <SheetTitle>
                <Logo />
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-5 p-4">
              {me?.tenant && <TrackingNumber e164={me.tenant.trackingNumber} />}
              <Nav items={SECONDARY_NAV} label="Business" />
              {me?.tenant && (
                <div className="border-t pt-3">
                  <UserMenu name={me.user.name} email={me.user.email} business={me.tenant.name} />
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

/** Four thumb-reachable tabs on phones; labels always visible, the active icon filled. */
function BottomTabs() {
  const pathname = usePathname();
  const waiting = useWaitingCount();
  if (isPushedScreen(pathname)) return null;

  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background lg:hidden" aria-label="Main">
      <div className="mx-auto grid h-14 max-w-md grid-cols-4">
        {PRIMARY_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = active && item.activeIcon ? item.activeIcon : item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex flex-col items-center justify-center gap-0.5 text-[13px] font-medium", active ? "text-primary" : "text-muted-foreground")}
            >
              <Icon className="size-6" stroke={1.75} />
              {item.label}
              {item.href === "/leads" && waiting > 0 && (
                <span className="tabular absolute top-1 left-1/2 ml-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-signal px-1 text-[11px] font-bold text-signal-foreground ring-2 ring-background">
                  {waiting}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function MainSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-48 rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-28 rounded-lg" />
      </div>
    </div>
  );
}
