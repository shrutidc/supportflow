const aiService = require('../services/ai.service');

/**
 * HTTP layer for AI features. The organization comes from req.auth, the
 * ticket from the path — never from the body.
 */

async function analyze(req, res) {
    const { ticketId, feature } = req.params;
    const { force } = req.validated.query;

    const { decision, cached } = await aiService.analyzeTicket(ticketId, feature, req.auth, {
        requestId: req.id,
        force
    });

    // Surfaced so the UI can say "reused an earlier answer" rather than
    // implying every view triggered a fresh model call.
    res.set('X-AI-Cache', cached ? 'hit' : 'miss');
    res.json(decision);
}

async function history(req, res) {
    const decisions = await aiService.listDecisions(req.params.ticketId, req.auth);
    res.json({ decisions });
}

async function feedback(req, res) {
    const decision = await aiService.recordFeedback(
        req.params.decisionId,
        req.validated.body,
        req.auth
    );
    res.json(decision);
}

module.exports = { analyze, history, feedback };
