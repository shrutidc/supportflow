"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PriorityBadge, StatusBadge } from "@/components/tickets/badges";
import { ApiError } from "@/lib/api/client";
import { useClaimTicket, useSendMessage, useTicket, useUpdateTicket } from "@/lib/api/hooks";
import { TICKET_STATUSES, type Message, type Ticket, type TicketStatus } from "@/lib/api/schemas";
import { formatLongDate, formatSlaCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AiPanel } from "./ai-panel";

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const { data: ticket, isPending, isError, error, refetch } = useTicket(ticketId);

  if (isPending) return <TicketDetailSkeleton />;

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-16 text-center">
        <h1 className="text-lg font-semibold">
          {notFound ? "Ticket not found" : "Failed to load ticket"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {notFound
            ? "This ticket does not exist or has been removed."
            : error instanceof Error
              ? error.message
              : "Something went wrong."}
        </p>
        <div className="flex gap-2">
          {!notFound && (
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          )}
          <Button asChild>
            <Link href="/inbox">Back to inbox</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <TicketDetailLoaded ticket={ticket} />;
}

function TicketDetailLoaded({ ticket }: { ticket: Ticket }) {
  const canClaim = !ticket.assignedTo && ticket.status !== "Closed" && ticket.status !== "Escalated";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
          <Link href="/inbox">
            <ArrowLeft className="size-4" />
            Back to inbox
          </Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{ticket.subject}</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">{ticket.ticketId}</span>
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status} />
            {canClaim && <ClaimButton ticketId={ticket.ticketId} />}
          </div>
        </div>
        <StatusSelect ticket={ticket} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Conversation ticket={ticket} />
          <Composer ticket={ticket} />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Customer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <InfoRow label="Name" value={ticket.customer.name} />
              <InfoRow label="Company" value={ticket.customer.company ?? "—"} />
              <InfoRow
                label="Email"
                value={
                  ticket.customer.email ? (
                    <a href={`mailto:${ticket.customer.email}`} className="text-primary hover:underline">
                      {ticket.customer.email}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <InfoRow label="Phone" value={ticket.customer.phone ?? "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Ticket</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <InfoRow label="Category" value={ticket.category} />
              <InfoRow label="Assignee" value={ticket.assignedTo ?? "Unassigned"} />
              <InfoRow label="Created" value={formatLongDate(ticket.createdAt)} />
              <Separator className="my-1" />
              <SlaRow deadline={ticket.slaDeadline} closed={ticket.status === "Closed"} />
            </CardContent>
          </Card>

          <AiPanel ticket={ticket} />
        </div>
      </div>
    </div>
  );
}

function ClaimButton({ ticketId }: { ticketId: string }) {
  const claim = useClaimTicket(ticketId);

  return (
    <Button
      size="sm"
      disabled={claim.isPending}
      onClick={() =>
        claim.mutate(undefined, {
          onSuccess: () => toast.success("Ticket claimed"),
          onError: (err) =>
            toast.error(
              err instanceof ApiError && err.status === 409
                ? "Ticket is already assigned to someone else."
                : "Failed to claim ticket.",
            ),
        })
      }
    >
      {claim.isPending ? "Claiming…" : "Claim ticket"}
    </Button>
  );
}

function StatusSelect({ ticket }: { ticket: Ticket }) {
  const update = useUpdateTicket(ticket.ticketId);

  return (
    <Select
      value={ticket.status}
      disabled={update.isPending}
      onValueChange={(value) =>
        update.mutate(
          { status: value as TicketStatus },
          {
            onSuccess: (t) => {
              if (t.status === "Escalated") {
                toast.info("Escalated to Engineering Queue — priority set to High, SLA tightened to 4h.");
              }
            },
            onError: () => toast.error("Failed to update status."),
          },
        )
      }
    >
      <SelectTrigger className="w-36" aria-label="Ticket status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TICKET_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Conversation({ ticket }: { ticket: Ticket }) {
  return (
    <Card className="py-0">
      <CardContent className="flex flex-col gap-4 p-4">
        {ticket.messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          ticket.messages.map((msg, i) => (
            <MessageBubble key={msg._id ?? i} message={msg} ticket={ticket} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function MessageBubble({ message, ticket }: { message: Message; ticket: Ticket }) {
  const isCustomer = message.sender === "customer";
  const senderName = isCustomer ? ticket.customer.name : (ticket.assignedTo ?? "Agent");
  const isNote = message.body.startsWith("[Internal Note]");

  return (
    <div className={cn("flex max-w-[85%] flex-col gap-1", isCustomer ? "self-start" : "self-end items-end")}>
      <span className="text-xs text-muted-foreground">
        {senderName} · {formatLongDate(message.timestamp)}
      </span>
      <div
        className={cn(
          "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
          isCustomer
            ? "bg-muted"
            : isNote
              ? "border border-dashed border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
              : "bg-primary text-primary-foreground",
        )}
      >
        {message.body}
      </div>
    </div>
  );
}

function Composer({ ticket }: { ticket: Ticket }) {
  const [body, setBody] = useState("");
  const send = useSendMessage(ticket.ticketId);

  function submit(kind: "reply" | "note") {
    const trimmed = body.trim();
    if (!trimmed) return;
    const finalBody = kind === "note" ? `[Internal Note] ${trimmed}` : trimmed;
    send.mutate(
      { sender: "agent", body: finalBody },
      {
        onSuccess: () => {
          setBody("");
          toast.success(kind === "note" ? "Internal note added" : "Reply sent");
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "Failed to send message."),
      },
    );
  }

  return (
    <Card className="py-0">
      <CardContent className="flex flex-col gap-3 p-4">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Type your reply to ${ticket.customer.name}…`}
          rows={4}
          aria-label="Message body"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit("reply");
          }}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={send.isPending || !body.trim()} onClick={() => submit("reply")}>
            Send reply
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={send.isPending || !body.trim()}
            onClick={() => submit("note")}
          >
            Add internal note
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">⌘⏎ to send</span>
        </div>
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}

function SlaRow({ deadline, closed }: { deadline: string; closed: boolean }) {
  const sla = formatSlaCountdown(deadline);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Clock className="size-3.5" /> SLA
      </span>
      <span
        className={cn(
          "font-medium",
          closed ? "text-muted-foreground" : sla.overdue ? "text-red-600 dark:text-red-400" : undefined,
        )}
      >
        {closed ? "Closed" : sla.label}
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          ({formatLongDate(deadline)})
        </span>
      </span>
    </div>
  );
}

function TicketDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <Skeleton className="h-8 w-32" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Skeleton className="h-96" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      </div>
    </div>
  );
}
