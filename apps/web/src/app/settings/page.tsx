import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Workspace settings arrive with authentication and organizations (Phase 3). Theme can be
        toggled from the sidebar.
      </p>
    </div>
  );
}
