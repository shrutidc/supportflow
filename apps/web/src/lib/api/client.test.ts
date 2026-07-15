import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchTicket, fetchTickets, patchTicket } from "./client";

const listItem = {
  _id: "a1",
  ticketId: "SF-1001",
  subject: "Cannot access billing portal",
  priority: "High",
  status: "New",
  assignedTo: null,
  lastUpdated: "2026-02-18T09:00:00.000Z",
  customer: { name: "Alice Walker", company: "Acme Corp" },
};

const fullTicket = {
  ...listItem,
  category: "Account Access",
  createdAt: "2026-02-18T09:00:00.000Z",
  slaDeadline: "2026-02-21T09:00:00.000Z",
  customer: {
    name: "Alice Walker",
    company: "Acme Corp",
    email: "alice@acmecorp.com",
    phone: "+1-555-0101",
  },
  messages: [{ sender: "customer", body: "Help!", timestamp: "2026-02-18T09:00:00.000Z" }],
};

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchTickets", () => {
  it("builds query params and validates the response", async () => {
    const fn = mockFetch(200, { tickets: [listItem] });
    const tickets = await fetchTickets({ status: "New", q: "billing", view: "assigned" });

    const url = fn.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("status")).toBe("New");
    expect(params.get("q")).toBe("billing");
    expect(params.get("view")).toBe("assigned");
    expect(tickets).toHaveLength(1);
    expect(tickets[0].ticketId).toBe("SF-1001");
  });

  it('omits "All" status and the "all" view from the query string', async () => {
    const fn = mockFetch(200, { tickets: [] });
    await fetchTickets({ status: "All", view: "all" });
    expect(fn.mock.calls[0][0]).toBe("/api/tickets");
  });

  it("rejects malformed responses (contract drift fails loudly)", async () => {
    mockFetch(200, { tickets: [{ nonsense: true }] });
    await expect(fetchTickets({})).rejects.toThrow();
  });
});

describe("error handling", () => {
  it("throws ApiError with status and server message", async () => {
    mockFetch(404, { error: "Ticket not found" });
    const err = await fetchTicket("SF-9999").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
    expect(err.message).toBe("Ticket not found");
  });

  it("surfaces 409 conflicts from claim attempts", async () => {
    mockFetch(409, { error: "Ticket is already assigned" });
    const err = await patchTicket("SF-1001", { assignedTo: "You", status: "In Progress" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
  });

  it("falls back to a generic message when the body is not JSON", async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
    });
    vi.stubGlobal("fetch", fn);
    const err = await fetchTicket("SF-1001").catch((e) => e);
    expect(err.message).toBe("Request failed (500)");
  });
});

describe("patchTicket", () => {
  it("sends a PATCH with the JSON body and validates the response", async () => {
    const fn = mockFetch(200, { ...fullTicket, status: "Closed" });
    const ticket = await patchTicket("SF-1001", { status: "Closed" });

    const [url, init] = fn.mock.calls[0];
    expect(url).toBe("/api/tickets/SF-1001");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "Closed" });
    expect(ticket.status).toBe("Closed");
  });
});
