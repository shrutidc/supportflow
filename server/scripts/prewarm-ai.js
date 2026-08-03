/**
 * Pre-generates AI decisions for a workspace.
 *
 *   node scripts/prewarm-ai.js --org-id=org_xxx [--limit=25] [--feature=triage]
 *
 * Why this exists: the Gemini free tier is rate limited to a handful of
 * requests per minute, and a visitor clicking "Run" on a live demo has a real
 * chance of hitting a 429 and concluding the feature is broken. Decisions are
 * cached by `inputHash`, so generating them ahead of time means clicking Run
 * on a pre-warmed ticket returns the stored answer instantly, with no model
 * call and no quota spent.
 *
 * Deliberately slow: it paces itself under the free-tier limit rather than
 * racing it. Expect roughly one ticket every few seconds.
 */
const mongoose = require('mongoose');
const env = require('../src/config/env');
const logger = require('../src/lib/logger');
const Ticket = require('../models/Ticket');
const aiService = require('../src/services/ai.service');

// Comfortably under the observed free-tier ceiling. Two features per ticket
// means the effective request rate is double this.
const DELAY_BETWEEN_CALLS_MS = 7000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
    const args = { orgId: null, limit: 25, features: ['triage', 'summarize'] };
    for (const arg of argv.slice(2)) {
        if (arg.startsWith('--org-id=')) args.orgId = arg.slice(9);
        else if (arg.startsWith('--limit=')) args.limit = parseInt(arg.slice(8), 10);
        else if (arg.startsWith('--feature=')) args.features = [arg.slice(10)];
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv);

    if (!args.orgId) {
        logger.error('--org-id is required');
        process.exit(1);
    }
    if (!env.aiServiceUrl) {
        logger.error('AI_SERVICE_URL is not set — nothing to call');
        process.exit(1);
    }

    await mongoose.connect(env.mongoUri);

    // Open tickets first: those are the ones a visitor is most likely to open
    // from the default inbox view.
    const tickets = await Ticket.find({
        organizationId: args.orgId,
        status: { $in: ['New', 'In Progress', 'Escalated'] }
    })
        .sort({ lastUpdated: -1 })
        .limit(args.limit)
        .select('ticketId');

    const auth = { organizationId: args.orgId, userId: 'system_prewarm' };
    let generated = 0;
    let cached = 0;
    let failed = 0;

    logger.info('Pre-warming', {
        tickets: tickets.length,
        features: args.features,
        estimatedMinutes: Math.ceil(
            (tickets.length * args.features.length * DELAY_BETWEEN_CALLS_MS) / 60000
        )
    });

    for (const ticket of tickets) {
        for (const feature of args.features) {
            try {
                const { cached: wasCached } = await aiService.analyzeTicket(
                    ticket.ticketId,
                    feature,
                    auth,
                    { requestId: 'prewarm' }
                );
                if (wasCached) {
                    cached += 1;
                } else {
                    generated += 1;
                    // Only pace after a real model call; a cache hit cost
                    // nothing and needs no cooldown.
                    await sleep(DELAY_BETWEEN_CALLS_MS);
                }
            } catch (err) {
                failed += 1;
                logger.warn('Pre-warm failed', {
                    ticketId: ticket.ticketId,
                    feature,
                    error: err.message
                });
                // A rate limit means the pace is still too fast; back off hard
                // rather than burning the rest of the quota failing.
                if (err.status === 429) await sleep(30000);
            }
        }
    }

    logger.info('Pre-warm complete', { generated, cached, failed });
    await mongoose.disconnect();
}

main().catch(err => {
    logger.error('Pre-warm failed', { error: err.message });
    process.exit(1);
});
