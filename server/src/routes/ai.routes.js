const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../lib/async-handler');
const validate = require('../middleware/validate');
const controller = require('../controllers/ai.controller');
const env = require('../config/env');
const { analyzeQuerySchema, feedbackSchema } = require('../validators/ai.validators');

const router = express.Router();

/**
 * A much tighter limit than the API-wide 300/min, which was sized for reading
 * tickets. These calls cost money and take seconds, so the ceiling is set by
 * what a person can plausibly use rather than by what the server can serve.
 * Cached results still pass through here, which is deliberate: the limit
 * protects the provider quota behind it.
 */
const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many AI requests. Please wait a moment.' }
});

if (!env.isTest) {
    router.use(aiLimiter);
}

// Analysis is a POST because it creates a decision record and may spend money —
// it is not a safe, repeatable read, whatever the response looks like.
//
// Declared as two explicit paths rather than `:feature(summarize|triage)`:
// Express 5 moved to path-to-regexp v8, which removed inline regex in route
// params. Listing them also means an unknown feature 404s at the router
// instead of reaching a handler that has to reject it.
const FEATURE_ROUTES = ['summarize', 'triage'];

for (const feature of FEATURE_ROUTES) {
    router.post(
        `/tickets/:ticketId/${feature}`,
        validate(analyzeQuerySchema, 'query'),
        asyncHandler((req, res) => {
            req.params.feature = feature;
            return controller.analyze(req, res);
        })
    );
}

router.get('/tickets/:ticketId/decisions', asyncHandler(controller.history));

router.post(
    '/decisions/:decisionId/feedback',
    validate(feedbackSchema, 'body'),
    asyncHandler(controller.feedback)
);

module.exports = router;
