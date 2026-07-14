const express = require('express');
const cors = require('cors');
const path = require('path');

const requestId = require('./middleware/request-id');
const errorHandler = require('./middleware/error-handler');
const ticketsRouter = require('./routes/tickets.routes');

/**
 * Builds the Express app without binding a port or touching the
 * database, so tests can exercise it with supertest.
 */
function createApp() {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(requestId);

    // Serve the static frontend from the repository root.
    app.use(express.static(path.join(__dirname, '..', '..')));

    app.use('/api/tickets', ticketsRouter);

    // JSON 404 for unknown API routes (static handler covers the rest).
    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    app.use(errorHandler);

    return app;
}

module.exports = createApp;
