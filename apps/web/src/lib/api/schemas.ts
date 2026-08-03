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

/** A quote tied to the message it came from, already verified server-side. */
export const aiEvidenceSchema = z.object({
  messageId: z.string(),
  quote: z.string(),
  reason: z.string().nullish(),
});

export const aiSummaryOutputSchema = z.object({
  headline: z.string(),
  // Facts are what the ticket states; inference is the model's reading. The
  // UI keeps them visually apart for the same reason the contract does.
  extracted_facts: z
    .array(z.object({ statement: z.string(), evidence: z.array(aiEvidenceSchema).default([]) }))
    .default([]),
  inference: z.array(z.string()).default([]),
  actions_attempted: z.array(z.string()).default([]),
  customer_goal: z.string().default(""),
  current_blocker: z.string().nullish(),
  missing_information: z.array(z.string()).default([]),
  suggested_next_action: z.string().default(""),
});

export const aiTriageOutputSchema = z.object({
  category: z.string(),
  priority: z.string(),
  urgency: z.string(),
  recommended_queue: z.string(),
  should_escalate: z.boolean(),
  confidence: z.number(),
  reasoning_summary: z.string(),
  evidence: z.array(aiEvidenceSchema).default([]),
  missing_information: z.array(z.string()).default([]),
});

export const aiDecisionSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  feature: z.enum(["summarize", "triage"]),
  model: z.string(),
  promptVersion: z.string(),
  output: z.unknown(),
  confidence: z.number(),
  evidence: z.array(aiEvidenceSchema).default([]),
  latencyMs: z.number(),
  tokenUsage: z.object({ input: z.number(), output: z.number() }),
  groundingDropped: z.number(),
  // null means nobody has judged it yet — not the same as rejected.
  userAction: z.enum(["accepted", "edited", "rejected"]).nullable(),
  createdAt: z.string(),
});

export const aiDecisionListSchema = z.object({ decisions: z.array(aiDecisionSchema) });

export type AiEvidence = z.infer<typeof aiEvidenceSchema>;
export type AiDecision = z.infer<typeof aiDecisionSchema>;
export type AiSummaryOutput = z.infer<typeof aiSummaryOutputSchema>;
export type AiTriageOutput = z.infer<typeof aiTriageOutputSchema>;
export type AiFeature = "summarize" | "triage";

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
