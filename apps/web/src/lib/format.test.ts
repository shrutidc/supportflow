import { describe, expect, it } from "vitest";
import { formatSlaCountdown } from "./format";

describe("formatSlaCountdown", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("reports minutes remaining under an hour", () => {
    const { label, overdue } = formatSlaCountdown("2026-07-15T12:25:00Z", now);
    expect(label).toBe("25m left");
    expect(overdue).toBe(false);
  });

  it("reports hours remaining under two days", () => {
    const { label, overdue } = formatSlaCountdown("2026-07-15T18:00:00Z", now);
    expect(label).toBe("6h left");
    expect(overdue).toBe(false);
  });

  it("reports days beyond 48 hours", () => {
    const { label } = formatSlaCountdown("2026-07-20T12:00:00Z", now);
    expect(label).toBe("5d left");
  });

  it("flags overdue deadlines", () => {
    const { label, overdue } = formatSlaCountdown("2026-07-15T09:00:00Z", now);
    expect(label).toBe("3h overdue");
    expect(overdue).toBe(true);
  });

  it("never reports zero minutes", () => {
    const { label } = formatSlaCountdown("2026-07-15T12:00:10Z", now);
    expect(label).toBe("1m left");
  });
});
