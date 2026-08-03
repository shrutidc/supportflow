"use client";

import { useOrganization, useUser } from "@clerk/nextjs";
import { Building2, ShieldCheck, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Workspace and account settings.
 *
 * Read-only on purpose. Clerk owns users, organizations, memberships, and
 * roles — mirroring them into an editable form here would create a second
 * source of truth that silently drifts from the one authorization actually
 * consults. Membership and role changes belong in Clerk's own interface.
 *
 * What this page is for is answering "which workspace am I in, and what am I
 * allowed to do?", which is otherwise only discoverable by attempting
 * something and being refused.
 */

/** Clerk's role keys mapped to what the API enforces. Mirrors server/src/lib/roles.js. */
const ROLE_LABELS: Record<string, { label: string; can: string }> = {
  "org:admin": {
    label: "Administrator",
    can: "Everything a manager can do, plus workspace administration.",
  },
  "org:manager": {
    label: "Manager",
    can: "Reassign tickets to other people or queues.",
  },
  "org:member": {
    label: "Agent",
    can: "Read, claim, reply, and change ticket status.",
  },
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export function SettingsView() {
  const { organization, membership, isLoaded: orgLoaded } = useOrganization();
  const { user, isLoaded: userLoaded } = useUser();

  if (!orgLoaded || !userLoaded) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
    );
  }

  // Unknown roles degrade to Agent, matching the API's deliberate choice to
  // fall back to the least privileged option rather than throw.
  const role = ROLE_LABELS[membership?.role ?? ""] ?? ROLE_LABELS["org:member"];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="size-4" />
              Workspace
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <Row label="Name" value={organization?.name ?? "—"} />
            <Row
              label="Members"
              value={organization?.membersCount ?? "—"}
            />
            <Separator className="my-1" />
            <Row
              label="Organization ID"
              value={
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {organization?.id ?? "—"}
                </code>
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Every ticket, decision, and metric in SupportFlow is scoped to this id, resolved
              from your session rather than anything the browser sends.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <User className="size-4" />
              Account
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            <Row label="Name" value={user?.fullName ?? user?.firstName ?? "—"} />
            <Row
              label="Email"
              value={user?.primaryEmailAddress?.emailAddress ?? "—"}
            />
            <Separator className="my-1" />
            <Row label="Appearance" value={<ThemeToggle />} />
            <p className="mt-1 text-xs text-muted-foreground">
              Profile and password are managed from the account menu in the sidebar.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="size-4" />
            Your role
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{role.label}</Badge>
            <span className="text-sm text-muted-foreground">{role.can}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Roles are assigned in Clerk and enforced by the API against the signed session —
            never against anything the browser claims. The tenant boundary outranks roles: an
            administrator of one workspace has no access to another&apos;s data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
