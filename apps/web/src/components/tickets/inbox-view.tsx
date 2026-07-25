"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriorityBadge, StatusBadge } from "@/components/tickets/badges";
import { useTickets } from "@/lib/api/hooks";
import { TICKET_STATUSES, type TicketStatus, type TicketView } from "@/lib/api/schemas";
import { formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const VIEW_TITLES: Record<TicketView, string> = {
  all: "Inbox",
  assigned: "Assigned to Me",
  escalations: "Escalations",
};

const STATUS_FILTERS = ["All", ...TICKET_STATUSES] as const;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function InboxView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const view = (searchParams.get("view") ?? "all") as TicketView;
  const statusParam = (searchParams.get("status") ?? "All") as TicketStatus | "All";
  // Escalations view implies the Escalated filter, like the legacy UI.
  const status = view === "escalations" && !searchParams.get("status") ? "Escalated" : statusParam;

  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search, 300);

  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data: tickets, isPending, isError, error, refetch } = useTickets({
    status,
    q: debouncedSearch || undefined,
    view,
  });

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "" || value === "All") params.delete(key);
        else params.set(key, value);
      }
      router.replace(`/inbox${params.size ? `?${params}` : ""}`, { scroll: false });
    },
    [router, searchParams],
  );

  // Keep the URL shareable: reflect the debounced search term.
  useEffect(() => {
    setParams({ q: debouncedSearch || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const openTicket = useCallback(
    (ticketId: string) => router.push(`/tickets/${encodeURIComponent(ticketId)}`),
    [router],
  );

  // Keyboard navigation: j/k or arrows to move, Enter to open, / to search.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (e.key === "Escape" && typing) {
        target.blur();
        return;
      }
      if (typing) return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, (tickets?.length ?? 0) - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && tickets && selectedIndex >= 0) {
        openTicket(tickets[selectedIndex].ticketId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tickets, selectedIndex, openTicket]);

  // Reset selection whenever the visible set changes (state adjustment
  // during render, per React's "adjusting state when props change" pattern).
  const filterKey = `${view}|${status}|${debouncedSearch}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setSelectedIndex(-1);
  }

  // Distinguishes "your filters matched nothing" from "there is nothing here".
  const hasActiveFilters = status !== "All" || debouncedSearch.length > 0 || view !== "all";

  const metrics = useMemo(() => {
    if (!tickets) return null;
    return {
      open: tickets.filter((t) => t.status === "New" || t.status === "In Progress").length,
      escalated: tickets.filter((t) => t.status === "Escalated").length,
      highPriority: tickets.filter((t) => t.priority === "High" && t.status !== "Closed").length,
      unassigned: tickets.filter((t) => !t.assignedTo && t.status !== "Closed").length,
    };
  }, [tickets]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">{VIEW_TITLES[view] ?? "Inbox"}</h1>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by subject…  ( / )"
            className="pl-8"
            aria-label="Search tickets by subject"
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Open" value={metrics?.open} />
        <MetricCard label="Escalated" value={metrics?.escalated} accent="text-red-600 dark:text-red-400" />
        <MetricCard label="High priority" value={metrics?.highPriority} />
        <MetricCard label="Unassigned" value={metrics?.unassigned} />
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            aria-pressed={status === s}
            onClick={() => setParams({ status: s })}
          >
            {s}
          </Button>
        ))}
      </div>

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load tickets{error instanceof Error ? `: ${error.message}` : "."}
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="w-[38%]">Subject</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead className="w-20">Priority</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-36 text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, c) => (
                      <TableCell key={c}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    {hasActiveFilters ? (
                      <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <p className="text-sm font-medium">No tickets match these filters</p>
                        <p className="text-sm text-muted-foreground">
                          Try widening your search or clearing the status filter.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearch("");
                            setParams({ status: null, q: null });
                          }}
                        >
                          Clear filters
                        </Button>
                      </div>
                    ) : (
                      // No filters are applied, so the workspace itself is empty —
                      // saying "adjust your filters" here would be misleading.
                      <div className="flex flex-col items-center gap-2 py-12 text-center">
                        <p className="text-sm font-medium">This workspace has no tickets yet</p>
                        <p className="max-w-md text-sm text-muted-foreground">
                          Tickets appear here as customers get in touch. To explore SupportFlow
                          with realistic data, load the demo dataset into this workspace.
                        </p>
                        <code className="mt-1 rounded bg-muted px-2 py-1 text-xs">
                          npm run seed -- --org-id=&lt;your-org-id&gt;
                        </code>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((t, i) => (
                  <TableRow
                    key={t.ticketId}
                    data-selected={i === selectedIndex || undefined}
                    onClick={() => openTicket(t.ticketId)}
                    className={cn(
                      "cursor-pointer",
                      i === selectedIndex && "bg-accent",
                      t.status === "Closed" && "opacity-60",
                    )}
                  >
                    <TableCell className="font-medium">{t.ticketId}</TableCell>
                    <TableCell>
                      <div className="font-medium">{t.customer.name}</div>
                      <div className="text-xs text-muted-foreground">{t.customer.company ?? "—"}</div>
                    </TableCell>
                    <TableCell className="max-w-0 truncate">{t.subject}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.assignedTo ?? "Unassigned"}
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={t.priority} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatShortDate(t.lastUpdated)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <kbd className="rounded border px-1">j</kbd>/<kbd className="rounded border px-1">k</kbd> to
        navigate · <kbd className="rounded border px-1">Enter</kbd> to open ·{" "}
        <kbd className="rounded border px-1">/</kbd> to search
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | undefined;
  accent?: string;
}) {
  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {value === undefined ? (
          <Skeleton className="mt-1 h-7 w-10" />
        ) : (
          <div className={cn("text-2xl font-semibold tabular-nums", accent)}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}
