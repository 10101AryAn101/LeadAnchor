"use client";

import type { CustomerListItem } from "@leadanchor/contracts";
import { IconChevronRight, IconSearch, IconUsers } from "@tabler/icons-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatPhone, money, timeAgo } from "@/lib/format";
import { useCustomers } from "@/lib/queries";

/** C-34: everyone who has called or sent a form. Each row opens their full history. */
export function CustomersView() {
  // The list comes from browser-side queries; render it only after hydration (see useHydrated).
  return useHydrated() ? <CustomersList /> : <ListSkeleton />;
}

function CustomersList() {
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim());
  const { data: customers, isPending } = useCustomers(query);

  return (
    <div className="space-y-4">
      <InputGroup className="max-w-md">
        <InputGroupAddon>
          <IconSearch />
        </InputGroupAddon>
        <InputGroupInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or number" aria-label="Search customers" />
      </InputGroup>

      {isPending || !customers ? (
        <ListSkeleton />
      ) : customers.length === 0 ? (
        <Empty className="rounded-lg border border-dashed py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconUsers />
            </EmptyMedia>
            <EmptyTitle>{query ? "No one matches that" : "No customers yet"}</EmptyTitle>
            <EmptyDescription>{query ? "Try part of the name or the last digits of their number." : "Everyone who calls or sends a form shows up here."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {customers.map((customer) => (
            <CustomerRow key={customer.id} customer={customer} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomerRow({ customer }: { customer: CustomerListItem }) {
  const name = customer.name ?? formatPhone(customer.phone);
  const jobs = `${customer.jobs} job${customer.jobs === 1 ? "" : "s"}${customer.openJobs > 0 ? `, ${customer.openJobs} open` : ""}`;
  return (
    <li>
      <Link href={`/customers/${customer.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{name}</span>
            {customer.jobs >= 2 && <Badge variant="outline">Repeat</Badge>}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {customer.name && <span className="tabular">{formatPhone(customer.phone)}. </span>}
            {jobs}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {customer.lifetimeValueCents > 0 && <span className="tabular block font-semibold">{money(customer.lifetimeValueCents)}</span>}
          <span className="block text-sm text-muted-foreground">{timeAgo(customer.lastActivityAt)}</span>
        </span>
        <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-lg" />
      ))}
    </div>
  );
}
