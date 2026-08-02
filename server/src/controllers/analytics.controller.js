const analyticsService = require('../services/analytics.service');

/**
 * HTTP layer for analytics. As with tickets, the organization comes from
 * req.auth — never from the query string.
 */
async function overview(req, res) {
    const { days } = req.validated.query;
    const data = await analyticsService.getOverview({ days }, req.auth);
    res.json(data);
}

module.exports = { overview };
