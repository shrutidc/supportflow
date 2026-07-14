/**
 * Error type carrying an HTTP status code, thrown from services and
 * translated to a JSON response by the central error handler.
 */
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}

module.exports = HttpError;
