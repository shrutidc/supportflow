import type { Metadata } from "next";
import { DashboardView } from "@/components/analytics/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational metrics for this workspace, computed from ticket data.
        </p>
      </header>
      <DashboardView />
    </div>
  );
}
