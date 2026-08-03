"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Clock, Inbox, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyticsOverview } from "@/lib/api/hooks";
import type { AnalyticsOverview } from "@/lib/api/schemas";

/**
 * Charts read their colours from the same `--chart-*` tokens the rest of the
 * app uses, so light and dark are handled by the theme rather than by
 * branching in here. Only two series ever share a plot; a third would need
 * direct labels to clear contrast on the light surface.
 */
const SERIES = {
  created: "var(--chart-1)",
  resolved: "var(--chart-2)",
  bar: "var(--chart-1)",
} as const;

const AXIS = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function formatHours(hours: number | null) {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

/** Recharts' default tooltip ignores the app's theme tokens. */
const tooltipStyle = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    fontSize: 12,
    color: "var(--popover-foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)", marginBottom: 4 },
} as const;

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="pl-0">{children}</CardContent>
    </Card>
  );
}

function Loaded({ data }: { data: AnalyticsOverview }) {
  const { totals, sla, resolution, volume, byQueue, backlogAge } = data;

  const compliance =
    sla.compliance === null ? "—" : `${Math.round(sla.compliance * 100)}%`;

  // Short weekday labels; the full date lives in the tooltip.
  const volumeData = volume.map((d) => ({
    ...d,
    label: new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Open tickets"
          value={String(totals.open)}
          hint={`${totals.unassigned} unassigned · ${totals.all} total`}
          icon={Inbox}
        />
        <StatTile
          label="SLA compliance"
          value={compliance}
          hint={`${sla.closedOnTime} of ${sla.closedTotal} resolved on time`}
          icon={ShieldCheck}
        />
        <StatTile
          label="Median resolution"
          value={formatHours(resolution.medianHours)}
          hint={`p90 ${formatHours(resolution.p90Hours)} · ${resolution.count} resolved`}
          icon={Clock}
        />
        <StatTile
          label="Past SLA"
          value={String(sla.openBreached)}
          hint={`of ${sla.openTotal} open · ${totals.escalated} escalated`}
          icon={AlertTriangle}
        />
      </div>

      <ChartCard
        title="Ticket volume"
        description={`Created against resolved, ${data.periodDays} days to yesterday`}
      >
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={volumeData} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" {...AXIS} minTickGap={24} />
            <YAxis {...AXIS} width={32} allowDecimals={false} />
            <Tooltip {...tooltipStyle} />
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            />
            <Line
              type="monotone"
              dataKey="created"
              name="Created"
              stroke={SERIES.created}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="resolved"
              name="Resolved"
              stroke={SERIES.resolved}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Open tickets by queue"
          description="Where unresolved work sits — busiest 8 queues"
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={byQueue}
              layout="vertical"
              margin={{ top: 4, right: 24, bottom: 0, left: 8 }}
            >
              <CartesianGrid stroke="var(--border)" horizontal={false} />
              <XAxis type="number" {...AXIS} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="queue"
                {...AXIS}
                width={132}
                interval={0}
              />
              <Tooltip {...tooltipStyle} cursor={{ fill: "var(--accent)" }} />
              <Bar dataKey="count" name="Tickets" fill={SERIES.bar} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Backlog age"
          description="How long open tickets have been waiting"
        >
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={backlogAge} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="bucket" {...AXIS} />
              <YAxis {...AXIS} width={32} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "var(--accent)" }} />
              <Bar dataKey="count" name="Tickets" fill={SERIES.bar} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
      <Skeleton className="h-[312px]" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[332px]" />
        <Skeleton className="h-[332px]" />
      </div>
    </div>
  );
}

export function DashboardView() {
  const { data, isPending, error } = useAnalyticsOverview();

  if (isPending) return <DashboardSkeleton />;

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm font-medium">Could not load analytics</p>
          <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (data.totals.all === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm font-medium">No tickets in this workspace yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Metrics appear once this workspace has tickets.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <Loaded data={data} />;
}
