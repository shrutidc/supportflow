import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Operational analytics arrive in a later phase. The legacy dashboard remains available on
        the Express app.
      </p>
    </div>
  );
}
