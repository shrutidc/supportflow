const { z } = require('zod');

/**
 * `force` bypasses the cached decision and pays for a fresh model call, so it
 * is opt-in rather than the default. Coerced from the query string, where
 * everything is text.
 */
const analyzeQuerySchema = z.object({
    force: z
        .enum(['true', 'false'])
        .catch('false')
        .default('false')
        .transform(value => value === 'true')
});

/**
 * What a human did with a recommendation.
 *
 * `rejected` is a judgement; no record at all means nobody has looked yet.
 * There is deliberately no way to submit "pending" — that is the absence of
 * feedback, not a kind of it.
 */
const feedbackSchema = z.object({
    userAction: z.enum(['accepted', 'edited', 'rejected'])
});

module.exports = { analyzeQuerySchema, feedbackSchema };
