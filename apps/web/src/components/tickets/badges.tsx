import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TicketPriority, TicketStatus } from "@/lib/api/schemas";

/**
 * Semantic badge colors for ticket status and priority.
 * Tuned for AA contrast in both light and dark themes.
 */

const STATUS_STYLES: Record<TicketStatus, string> = {
  New: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-transparent",
  "In Progress":
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-transparent",
  Escalated: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-transparent",
  Closed: "bg-muted text-muted-foreground border-transparent",
};

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  High: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-transparent",
  Medium:
    "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border-transparent",
  Low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-transparent",
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return <Badge className={cn(STATUS_STYLES[status], className)}>{status}</Badge>;
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string;
}) {
  return <Badge className={cn(PRIORITY_STYLES[priority], className)}>{priority}</Badge>;
}
