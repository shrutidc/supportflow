/**
 * Thin bootstrap: validate env -> connect database -> listen.
 * The app itself is assembled in src/app.js; DB startup in src/db/connect.js.
 */
const env = require('./src/config/env');
const logger = require('./src/lib/logger');
const { connectDatabase } = require('./src/db/connect');
const createApp = require('./src/app');

async function main() {
    // Listen only after the database is ready so early requests
    // never hit an unconnected Mongoose instance.
    await connectDatabase();

    const app = createApp();
    app.listen(env.port, () => {
        logger.info('Server listening', { port: env.port, env: env.nodeEnv });
    });
}

main().catch(err => {
    logger.error('Startup failed', { error: err.message, stack: err.stack });
    process.exit(1);
});
