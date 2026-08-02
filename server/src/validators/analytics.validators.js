const { z } = require('zod');

/**
 * The reporting window, in days. Capped at 90 because every day widens the
 * aggregation, and an unbounded value would let one request scan the whole
 * collection.
 */
const overviewQuerySchema = z.object({
    days: z.coerce.number().int().min(1).max(90).catch(14).default(14)
});

module.exports = { overviewQuerySchema };
