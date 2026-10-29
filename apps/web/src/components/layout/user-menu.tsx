"use client";

import { IconDeviceDesktop, IconLogout, IconMoon, IconSelector, IconSun } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth-client";
import { initials } from "@/lib/format";

export function UserMenu({ name, email, business }: { name: string; email: string; business: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();

  const handleSignOut = async () => {
    await signOut();
    queryClient.clear();
    router.replace("/sign-in");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50">
        <Avatar className="size-9">
          <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">{initials(name)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block truncate text-sm text-muted-foreground">{business}</span>
        </span>
        <IconSelector className="size-[18px] text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-sm">
            <span className="block truncate font-semibold text-foreground">{name}</span>
            <span className="block truncate font-normal">{email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(value) => setTheme(String(value))}>
            <DropdownMenuRadioItem value="light">
              <IconSun /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <IconMoon /> Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <IconDeviceDesktop /> Match device
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <IconLogout /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
