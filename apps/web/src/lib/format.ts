const shortFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const longFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatShortDate(iso: string): string {
  return shortFormat.format(new Date(iso));
}

export function formatLongDate(iso: string): string {
  return longFormat.format(new Date(iso));
}

/** "3h left" / "2d overdue" style SLA countdown. */
export function formatSlaCountdown(deadlineIso: string, now = new Date()): {
  label: string;
  overdue: boolean;
} {
  const diffMs = new Date(deadlineIso).getTime() - now.getTime();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);

  const hours = Math.round(abs / 3_600_000);
  const label =
    hours < 1
      ? `${Math.max(1, Math.round(abs / 60_000))}m`
      : hours < 48
        ? `${hours}h`
        : `${Math.round(hours / 24)}d`;

  return { label: overdue ? `${label} overdue` : `${label} left`, overdue };
}
