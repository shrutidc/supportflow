import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AiDecision, Ticket } from "@/lib/api/schemas";

/**
 * The panel's two guarantees, which are behavioural rather than visual:
 *
 * 1. Analysis never fires from a render — it costs money and takes seconds.
 * 2. A recommendation never changes the ticket until a human clicks Apply.
 *
 * Both are the kind of thing that breaks silently in a refactor, so they are
 * asserted rather than assumed.
 */

const analyzeMutate = vi.fn();
const updateMutate = vi.fn();
const feedbackMutate = vi.fn();
const decisionsResult = { data: [] as AiDecision[], isPending: false };

vi.mock("@/lib/api/hooks", () => ({
  useAiDecisions: () => decisionsResult,
  useAnalyzeTicket: () => ({ mutate: analyzeMutate, isPending: false }),
  useAiFeedback: () => ({ mutate: feedbackMutate, isPending: false }),
  useUpdateTicket: () => ({ mutate: updateMutate, isPending: false }),
}));

const { AiPanel } = await import("./ai-panel");

const ticket = {
  _id: "t1",
  ticketId: "SF-2001",
  subject: "Export failing",
  priority: "Medium",
  status: "New",
  category: "Incident",
  organizationId: "org_test",
  createdAt: "2026-08-01T09:00:00.000Z",
  slaDeadline: "2026-08-02T09:00:00.000Z",
  lastUpdated: "2026-08-01T09:00:00.000Z",
  customer: { name: "Amara Okafor", company: "Northwind" },
  messages: [
    { _id: "m1", sender: "customer", body: "Export is completely blocked.", timestamp: "x" },
  ],
} as unknown as Ticket;

function triageDecision(overrides: Partial<AiDecision> = {}): AiDecision {
  return {
    id: "d1",
    ticketId: "SF-2001",
    feature: "triage",
    model: "gemini-3.6-flash",
    promptVersion: "triage/v1",
    confidence: 0.91,
    latencyMs: 10400,
    tokenUsage: { input: 390, output: 186 },
    groundingDropped: 0,
    userAction: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    evidence: [],
    output: {
      category: "Incident",
      priority: "High",
      urgency: "High",
      recommended_queue: "Technical Support",
      should_escalate: true,
      confidence: 0.91,
      reasoning_summary: "Production impact reported.",
      evidence: [
        { messageId: "m1", quote: "completely blocked", reason: "Shows impact" },
      ],
      missing_information: ["Affected environment"],
    },
    ...overrides,
  } as AiDecision;
}

beforeEach(() => {
  analyzeMutate.mockClear();
  updateMutate.mockClear();
  feedbackMutate.mockClear();
  decisionsResult.data = [];
});

describe("AiPanel", () => {
  it("does not call the model just because it rendered", () => {
    render(<AiPanel ticket={ticket} />);
    // The most expensive possible bug: a paid call on every page view.
    expect(analyzeMutate).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /run/i })).toHaveLength(2);
  });

  it("runs only when asked", async () => {
    render(<AiPanel ticket={ticket} />);
    await userEvent.click(screen.getAllByRole("button", { name: /^run$/i })[0]);

    expect(analyzeMutate).toHaveBeenCalledTimes(1);
    expect(analyzeMutate.mock.calls[0][0]).toEqual({ feature: "triage", force: false });
  });

  it("shows the recommendation with the quotes behind it", () => {
    decisionsResult.data = [triageDecision()];
    render(<AiPanel ticket={ticket} />);

    expect(screen.getByText("High priority")).toBeInTheDocument();
    expect(screen.getByText("Technical Support")).toBeInTheDocument();
    expect(screen.getByText(/Suggests escalation/)).toBeInTheDocument();
    expect(screen.getByText("91% confidence")).toBeInTheDocument();
    // The quote, and where it came from, so the claim can be checked.
    expect(screen.getByText("completely blocked")).toBeInTheDocument();
    expect(screen.getByText(/From the customer's message/)).toBeInTheDocument();
  });

  it("leaves the ticket alone until Apply is clicked", async () => {
    decisionsResult.data = [triageDecision()];
    render(<AiPanel ticket={ticket} />);

    // Rendering a recommendation to change priority must not change it.
    expect(updateMutate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Set priority to High/i }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0][0]).toEqual({ priority: "High" });
  });

  it("records a dismissal as a judgement", async () => {
    decisionsResult.data = [triageDecision()];
    render(<AiPanel ticket={ticket} />);

    await userEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(feedbackMutate).toHaveBeenCalledWith({ decisionId: "d1", userAction: "rejected" });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("offers no action once a human has already judged it", () => {
    decisionsResult.data = [triageDecision({ userAction: "accepted" })];
    render(<AiPanel ticket={ticket} />);

    expect(screen.getByText(/Applied by an agent/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set priority/i })).not.toBeInTheDocument();
  });

  it("does not offer to apply a priority the ticket already has", () => {
    const decision = triageDecision();
    (decision.output as Record<string, unknown>).priority = "Medium";
    decisionsResult.data = [decision];
    render(<AiPanel ticket={ticket} />);

    expect(screen.getByRole("button", { name: /Already this priority/i })).toBeDisabled();
  });

  it("flags discarded quotes rather than hiding them", () => {
    decisionsResult.data = [triageDecision({ groundingDropped: 2 })];
    render(<AiPanel ticket={ticket} />);
    // Fabricated evidence is dropped server-side; the agent should know it
    // happened rather than see a quietly shorter list.
    expect(screen.getByText(/2 unverifiable quotes discarded/i)).toBeInTheDocument();
  });

  it("keeps stated facts apart from the model's inference", () => {
    decisionsResult.data = [
      triageDecision({
        id: "d2",
        feature: "summarize",
        output: {
          headline: "Customer cannot export.",
          extracted_facts: [
            {
              statement: "Export produces no file.",
              evidence: [{ messageId: "m1", quote: "completely blocked", reason: "" }],
            },
          ],
          inference: ["Likely a permissions problem."],
          actions_attempted: [],
          customer_goal: "Get the export working.",
          current_blocker: null,
          missing_information: [],
          suggested_next_action: "Ask which report.",
        },
      }),
    ];
    render(<AiPanel ticket={ticket} />);

    expect(screen.getByText(/Stated in the ticket/i)).toBeInTheDocument();
    expect(screen.getByText(/Model's reading — not stated/i)).toBeInTheDocument();
  });
});
