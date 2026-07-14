/**
 * Generic Zod validation middleware. On success the parsed (whitelisted,
 * coerced) value replaces the raw input; on failure the request is
 * rejected with 400 and the first human-readable issue.
 */
function validate(schema, source = 'body') {
    return (req, res, next) => {
        const result = schema.safeParse(req[source] ?? {});
        if (!result.success) {
            const issue = result.error.issues[0];
            const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
            return res.status(400).json({ error: `${where}${issue.message}` });
        }
        req.validated = req.validated || {};
        req.validated[source] = result.data;
        next();
    };
}

module.exports = validate;
