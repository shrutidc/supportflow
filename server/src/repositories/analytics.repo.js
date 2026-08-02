const Ticket = require('../../models/Ticket');

/**
 * Organization-scoped analytics aggregations.
 *
 * Mirrors ticket.repo.js deliberately: `forOrg(organizationId)` is the only
 * export and every pipeline starts from that match, so an analytics query
 * cannot be written that reads across tenants. Aggregation is exactly where
 * that mistake would be easiest to make and hardest to spot, because a
 * `$group` over the wrong scope still returns plausible numbers.
 *
 * All Mongoose access for analytics lives here. No business rules, no HTTP.
 */

const OPEN_STATUSES = ['New', 'In Progress', 'Escalated'];

function countBy(field) {
    return [{ $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }];
}

function forOrg(organizationId) {
    if (!organizationId) {
        throw new Error('analyticsRepo.forOrg requires an organizationId');
    }

    return {
        /**
         * One faceted aggregation rather than six round trips: every facet
         * shares the same organization match, so the scope is applied once and
         * cannot drift between metrics.
         */
        async overview({ days }) {
            const now = new Date();

            // Aligned to the start of the earliest UTC day the series will
            // show. A rolling `now - days` cutoff lands mid-day, so tickets
            // from earlier that same day are aggregated and then silently
            // dropped by the service, which buckets by calendar date.
            const since = new Date(now.getTime() - (days - 1) * 24 * 3600 * 1000);
            since.setUTCHours(0, 0, 0, 0);

            const [result] = await Ticket.aggregate([
                { $match: { organizationId } },
                {
                    $facet: {
                        byStatus: countBy('status'),
                        byPriority: countBy('priority'),
                        // Open work only. Counting closed tickets here would
                        // answer "where has volume come from historically",
                        // which is a different question from the operational
                        // one this feeds: where unresolved work is sitting now.
                        byQueue: [
                            { $match: { queue: { $ne: null }, status: { $in: OPEN_STATUSES } } },
                            ...countBy('queue'),
                            { $limit: 8 }
                        ],

                        totals: [
                            {
                                $group: {
                                    _id: null,
                                    all: { $sum: 1 },
                                    closed: {
                                        $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] }
                                    },
                                    escalated: {
                                        $sum: { $cond: [{ $eq: ['$status', 'Escalated'] }, 1, 0] }
                                    },
                                    unassigned: {
                                        $sum: {
                                            $cond: [
                                                {
                                                    $and: [
                                                        { $ne: ['$status', 'Closed'] },
                                                        { $eq: ['$assignedTo', null] }
                                                    ]
                                                },
                                                1,
                                                0
                                            ]
                                        }
                                    }
                                }
                            }
                        ],

                        sla: [
                            {
                                $group: {
                                    _id: null,
                                    closedTotal: {
                                        $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] }
                                    },
                                    // "Met" means resolved before its deadline.
                                    closedOnTime: {
                                        $sum: {
                                            $cond: [
                                                {
                                                    $and: [
                                                        { $eq: ['$status', 'Closed'] },
                                                        { $lte: ['$lastUpdated', '$slaDeadline'] }
                                                    ]
                                                },
                                                1,
                                                0
                                            ]
                                        }
                                    },
                                    openTotal: {
                                        $sum: { $cond: [{ $ne: ['$status', 'Closed'] }, 1, 0] }
                                    },
                                    // Open work whose deadline has already passed.
                                    openBreached: {
                                        $sum: {
                                            $cond: [
                                                {
                                                    $and: [
                                                        { $ne: ['$status', 'Closed'] },
                                                        { $lt: ['$slaDeadline', now] }
                                                    ]
                                                },
                                                1,
                                                0
                                            ]
                                        }
                                    }
                                }
                            }
                        ],

                        // ponytail: collects every duration to percentile it in
                        // the service. Fine for a workspace of this size; past
                        // ~100k closed tickets this needs $percentile (Mongo 7+)
                        // or a pre-aggregated rollup.
                        resolutionHours: [
                            { $match: { status: 'Closed' } },
                            {
                                $project: {
                                    _id: 0,
                                    hours: {
                                        $divide: [
                                            { $subtract: ['$lastUpdated', '$createdAt'] },
                                            3600000
                                        ]
                                    }
                                }
                            }
                        ],

                        backlogAgeHours: [
                            { $match: { status: { $in: OPEN_STATUSES } } },
                            {
                                $project: {
                                    _id: 0,
                                    hours: {
                                        $divide: [{ $subtract: [now, '$createdAt'] }, 3600000]
                                    }
                                }
                            }
                        ],

                        created: [
                            { $match: { createdAt: { $gte: since } } },
                            {
                                $group: {
                                    _id: {
                                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                                    },
                                    count: { $sum: 1 }
                                }
                            },
                            { $sort: { _id: 1 } }
                        ],

                        resolved: [
                            {
                                $match: {
                                    status: 'Closed',
                                    lastUpdated: { $gte: since }
                                }
                            },
                            {
                                $group: {
                                    _id: {
                                        $dateToString: { format: '%Y-%m-%d', date: '$lastUpdated' }
                                    },
                                    count: { $sum: 1 }
                                }
                            },
                            { $sort: { _id: 1 } }
                        ]
                    }
                }
            ]);

            return result;
        }
    };
}

module.exports = { forOrg, OPEN_STATUSES };
