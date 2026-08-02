const analyticsRepo = require('../repositories/analytics.repo');
const { BACKLOG_BUCKETS } = require('../repositories/analytics.repo');

/**
 * Operational metrics for a workspace.
 *
 * The repository returns raw groupings; the shaping, percentiles, and derived
 * rates live here. Computed metrics are kept strictly separate from anything
 * interpretive — this service reports what the data says and nothing about
 * what it means.
 */

const DEFAULT_DAYS = 14;

/** Nearest-rank percentile. `sorted` must be ascending and non-empty. */
function percentile(sorted, p) {
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function round(value, dp = 1) {
    const f = 10 ** dp;
    return Math.round(value * f) / f;
}

function toBuckets(hours) {
    const counts = BACKLOG_BUCKETS.map(b => ({ bucket: b.label, count: 0 }));
    for (const h of hours) {
        const index = BACKLOG_BUCKETS.findIndex(b => h < b.maxHours);
        counts[index === -1 ? counts.length - 1 : index].count += 1;
    }
    return counts;
}

/** Fills gaps so a quiet day plots as zero rather than vanishing from the line. */
function toDailySeries(created, resolved, days) {
    const byDay = new Map();
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
        byDay.set(date, { date, created: 0, resolved: 0 });
    }
    for (const row of created) {
        if (byDay.has(row._id)) byDay.get(row._id).created = row.count;
    }
    for (const row of resolved) {
        if (byDay.has(row._id)) byDay.get(row._id).resolved = row.count;
    }
    return [...byDay.values()];
}

async function getOverview({ days = DEFAULT_DAYS } = {}, auth) {
    const facets = await analyticsRepo.forOrg(auth.organizationId).overview({ days });

    const totals = facets.totals[0] ?? { all: 0, closed: 0, escalated: 0, unassigned: 0 };
    const sla = facets.sla[0] ?? {
        closedTotal: 0,
        closedOnTime: 0,
        openTotal: 0,
        openBreached: 0
    };

    const resolutionHours = facets.resolutionHours.map(r => r.hours).sort((a, b) => a - b);
    const backlogHours = facets.backlogAgeHours.map(r => r.hours);

    return {
        periodDays: days,

        totals: {
            all: totals.all,
            open: totals.all - totals.closed,
            closed: totals.closed,
            escalated: totals.escalated,
            unassigned: totals.unassigned
        },

        byStatus: facets.byStatus.map(r => ({ status: r._id, count: r.count })),
        byPriority: facets.byPriority.map(r => ({ priority: r._id, count: r.count })),
        byQueue: facets.byQueue.map(r => ({ queue: r._id, count: r.count })),

        sla: {
            closedTotal: sla.closedTotal,
            closedOnTime: sla.closedOnTime,
            // Null rather than 0 when nothing has closed yet: a workspace with
            // no history has no compliance rate, and 0% would read as failure.
            compliance: sla.closedTotal ? round(sla.closedOnTime / sla.closedTotal, 3) : null,
            openTotal: sla.openTotal,
            openBreached: sla.openBreached
        },

        resolution: resolutionHours.length
            ? {
                  count: resolutionHours.length,
                  medianHours: round(percentile(resolutionHours, 50)),
                  p90Hours: round(percentile(resolutionHours, 90))
              }
            : { count: 0, medianHours: null, p90Hours: null },

        backlogAge: toBuckets(backlogHours),
        volume: toDailySeries(facets.created, facets.resolved, days)
    };
}

module.exports = { getOverview };
