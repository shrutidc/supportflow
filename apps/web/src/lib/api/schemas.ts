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

export type TicketListFilters = {
  status?: TicketStatus | "All";
  q?: string;
  view?: TicketView;
};
