import { z } from "zod";

/**
 * Zod schemas for the Express API wire contract.
 *
 * Responses are validated at the fetch boundary so any drift between the
 * API and this app fails loudly in development instead of rendering
 * undefined. These move to a shared package when the monorepo lands.
 */

export const TICKET_STATUSES = ["New", "In Progress", "Escalated", "Closed"] as const;
export const TICKET_PRIORITIES = ["Low", "Medium", "High"] as const;

export const ticketStatusSchema = z.enum(TICKET_STATUSES);
export const ticketPrioritySchema = z.enum(TICKET_PRIORITIES);

export type TicketStatus = z.infer<typeof ticketStatusSchema>;
export type TicketPriority = z.infer<typeof ticketPrioritySchema>;

export const ticketListItemSchema = z.object({
  _id: z.string(),
  ticketId: z.string(),
  subject: z.string(),
  priority: ticketPrioritySchema,
  status: ticketStatusSchema,
  /** Display label: a member's name, or a queue such as "Engineering Queue". */
  assignedTo: z.string().nullish(),
  /** Set only when a real person owns the ticket (null for queues). */
  assignedToUserId: z.string().nullish(),
  lastUpdated: z.string(),
  customer: z.object({
    name: z.string(),
    company: z.string().nullish(),
  }),
});

export const ticketListResponseSchema = z.object({
  tickets: z.array(ticketListItemSchema),
});

export const messageSchema = z.object({
  _id: z.string().optional(),
  sender: z.enum(["customer", "agent"]),
  body: z.string(),
  timestamp: z.string(),
});

export const ticketSchema = ticketListItemSchema.extend({
  organizationId: z.string(),
  category: z.string(),
  createdAt: z.string(),
  slaDeadline: z.string(),
  customer: z.object({
    name: z.string(),
    company: z.string().nullish(),
    email: z.string().nullish(),
    phone: z.string().nullish(),
  }),
  messages: z.array(messageSchema),
});

export type TicketListItem = z.infer<typeof ticketListItemSchema>;
export type Ticket = z.infer<typeof ticketSchema>;
export type Message = z.infer<typeof messageSchema>;

export type TicketView = "all" | "assigned" | "escalations";

/**
 * Operational metrics. Every rate is nullable: a workspace with nothing closed
 * yet has no compliance rate, and rendering 0% there would read as total
 * failure rather than "no data".
 */
export const analyticsOverviewSchema = z.object({
  periodDays: z.number(),
  totals: z.object({
    all: z.number(),
    open: z.number(),
    closed: z.number(),
    escalated: z.number(),
    unassigned: z.number(),
  }),
  byStatus: z.array(z.object({ status: z.string(), count: z.number() })),
  byPriority: z.array(z.object({ priority: z.string(), count: z.number() })),
  byQueue: z.array(z.object({ queue: z.string(), count: z.number() })),
  sla: z.object({
    closedTotal: z.number(),
    closedOnTime: z.number(),
    compliance: z.number().nullable(),
    openTotal: z.number(),
    openBreached: z.number(),
  }),
  resolution: z.object({
    count: z.number(),
    medianHours: z.number().nullable(),
    p90Hours: z.number().nullable(),
  }),
  backlogAge: z.array(z.object({ bucket: z.string(), count: z.number() })),
  volume: z.array(
    z.object({ date: z.string(), created: z.number(), resolved: z.number() }),
  ),
});

export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

export type TicketListFilters = {
  status?: TicketStatus | "All";
  q?: string;
  view?: TicketView;
};
