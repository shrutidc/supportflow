/**
 * Wraps an async route handler so rejected promises reach the
 * central error handler instead of crashing or hanging the request.
 */
module.exports = function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
