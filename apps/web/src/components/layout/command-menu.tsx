"use client";

import { LEAD_STAGE_LABELS } from "@leadanchor/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { formatPhone } from "@/lib/format";
import { useLeads } from "@/lib/queries";
import { PRIMARY_NAV, SECONDARY_NAV } from "./nav-items";

const OPEN_EVENT = "leadanchor:open-search";

/** Opens the search from anywhere (header buttons, empty states). */
export const openCommandMenu = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Ctrl/⌘+K: jump to any page or find a customer by name, number or job. */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { data: leads } = useLeads();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Find a page, customer or job">
      <CommandInput placeholder="Search customers, numbers and jobs" />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>
        {leads && leads.length > 0 && (
          <CommandGroup heading="Customers and jobs">
            {leads.slice(0, 60).map((lead) => (
              <CommandItem
                key={lead.id}
                value={`${lead.title} ${lead.customer.name ?? ""} ${lead.customer.phone ?? ""} ${formatPhone(lead.customer.phone)}`}
                onSelect={() => go(`/leads/${lead.id}`)}
              >
                <span className="truncate font-medium">{lead.customer.name ?? formatPhone(lead.customer.phone)}</span>
                <span className="truncate text-muted-foreground">{lead.title}</span>
                <CommandShortcut>{LEAD_STAGE_LABELS[lead.stage]}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Go to">
          {[...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => (
            <CommandItem key={item.href} value={`page ${item.label}`} onSelect={() => go(item.href)}>
              <item.icon /> {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
