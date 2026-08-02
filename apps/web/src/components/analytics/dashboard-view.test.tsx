import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnalyticsOverview } from "@/lib/api/schemas";

/**
 * Guards the states the charts are actually rendered in. A successful build
 * says the types line up; it does not say Recharts renders without throwing,
 * and the dashboard sits behind authentication so it cannot be checked by
 * loading the page anonymously.
 *
 * ResponsiveContainer measures the DOM, which is 0x0 in jsdom, so it is
 * replaced with a fixed-size box. The charts inside are still constructed and
 * a crash still fails the test — which is the point.
 */
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 640, height: 280 }}>{children}</div>
    ),
  };
});

const mockUseAnalyticsOverview = vi.fn();
vi.mock("@/lib/api/hooks", () => ({
  useAnalyticsOverview: () => mockUseAnalyticsOverview(),
}));

const { DashboardView } = await import("./dashboard-view");

const overview: AnalyticsOverview = {
  periodDays: 14,
  totals: { all: 420, open: 138, closed: 282, escalated: 31, unassigned: 37 },
  byStatus: [
    { status: "Closed", count: 282 },
    { status: "In Progress", count: 70 },
  ],
  byPriority: [{ priority: "Medium", count: 169 }],
  byQueue: [
    { queue: "Technical Support", count: 115 },
    { queue: "Customer Service", count: 75 },
  ],
  sla: {
    closedTotal: 282,
    closedOnTime: 225,
    compliance: 0.798,
    openTotal: 138,
    openBreached: 120,
  },
  resolution: { count: 282, medianHours: 9.2, p90Hours: 44.5 },
  backlogAge: [
    { bucket: "< 4h", count: 2 },
    { bucket: "> 7d", count: 78 },
  ],
  volume: [
    { date: "2026-08-01", created: 24, resolved: 17 },
    { date: "2026-08-02", created: 6, resolved: 6 },
  ],
};

function mockState(state: Record<string, unknown>) {
  mockUseAnalyticsOverview.mockReturnValue({
    data: undefined,
    isPending: false,
    error: null,
    ...state,
  });
}

describe("DashboardView", () => {
  it("renders every metric and chart without throwing", () => {
    mockState({ data: overview });
    render(<DashboardView />);

    expect(screen.getByText("138")).toBeInTheDocument(); // open tickets
    expect(screen.getByText("80%")).toBeInTheDocument(); // rounded compliance
    expect(screen.getByText("9.2h")).toBeInTheDocument(); // median resolution
    expect(screen.getByText("120")).toBeInTheDocument(); // past SLA

    expect(screen.getByText("Ticket volume")).toBeInTheDocument();
    expect(screen.getByText("Open tickets by queue")).toBeInTheDocument();
    expect(screen.getByText("Backlog age")).toBeInTheDocument();
  });

  it("shows a dash rather than 0% when nothing has been resolved yet", () => {
    mockState({
      data: {
        ...overview,
        sla: { ...overview.sla, compliance: null, closedTotal: 0, closedOnTime: 0 },
        resolution: { count: 0, medianHours: null, p90Hours: null },
      },
    });
    render(<DashboardView />);

    // 0% would read as total failure; no closed tickets means no rate exists.
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("explains an empty workspace instead of charting zeroes", () => {
    mockState({
      data: {
        ...overview,
        totals: { all: 0, open: 0, closed: 0, escalated: 0, unassigned: 0 },
      },
    });
    render(<DashboardView />);

    expect(screen.getByText(/No tickets in this workspace yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Ticket volume")).not.toBeInTheDocument();
  });

  it("surfaces the reason when analytics fail to load", () => {
    mockState({ error: new Error("Support API is unavailable") });
    render(<DashboardView />);

    expect(screen.getByText(/Could not load analytics/i)).toBeInTheDocument();
    expect(screen.getByText("Support API is unavailable")).toBeInTheDocument();
  });
});
