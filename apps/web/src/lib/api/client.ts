import {
  analyticsOverviewSchema,
  ticketListResponseSchema,
  ticketSchema,
  type AnalyticsOverview,
  type Ticket,
  type TicketListFilters,
  type TicketListItem,
  type TicketPriority,
  type TicketStatus,
} from "./schemas";

/** Error carrying the HTTP status so UI can react to 404/409 specifically. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      data && typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return data as T;
}

export async function fetchTickets(filters: TicketListFilters): Promise<TicketListItem[]> {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "All") params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.view && filters.view !== "all") params.set("view", filters.view);

  const qs = params.toString();
  const data = await request<unknown>(`/api/tickets${qs ? `?${qs}` : ""}`);
  return ticketListResponseSchema.parse(data).tickets;
}

export async function fetchAnalyticsOverview(days = 14): Promise<AnalyticsOverview> {
  const data = await request<unknown>(`/api/analytics/overview?days=${days}`);
  return analyticsOverviewSchema.parse(data);
}

export async function fetchTicket(ticketId: string): Promise<Ticket> {
  const data = await request<unknown>(`/api/tickets/${encodeURIComponent(ticketId)}`);
  return ticketSchema.parse(data);
}

export type TicketPatch = {
  status?: TicketStatus;
  priority?: TicketPriority;
  /** Reassignment — the API requires a manager role for this field. */
  assignedTo?: string | null;
};

/**
 * Take ownership of an unassigned ticket. The owner is the authenticated
 * caller, so this carries no body. Throws ApiError(409) if someone else
 * claimed it first.
 */
export async function claimTicket(ticketId: string): Promise<Ticket> {
  const data = await request<unknown>(`/api/tickets/${encodeURIComponent(ticketId)}/claim`, {
    method: "POST",
  });
  return ticketSchema.parse(data);
}

export async function patchTicket(ticketId: string, patch: TicketPatch): Promise<Ticket> {
  const data = await request<unknown>(`/api/tickets/${encodeURIComponent(ticketId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return ticketSchema.parse(data);
}

// The API only accepts agent messages; customer messages arrive through
// ingestion channels (later phases), never from this client.
export async function postMessage(
  ticketId: string,
  message: { sender: "agent"; body: string },
): Promise<Ticket> {
  const data = await request<unknown>(`/api/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: "POST",
    body: JSON.stringify(message),
  });
  return ticketSchema.parse(data);
}
