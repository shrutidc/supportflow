const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Ticket = require('../../models/Ticket');
const logger = require('../lib/logger');

/**
 * Loads the demo dataset from the frontend's data.js without the old
 * write-a-temp-file-and-require-it hack: the script is evaluated in an
 * isolated vm sandbox that provides the `window` global it expects.
 */
function loadSupportData() {
    const dataJsPath = path.join(__dirname, '..', '..', '..', 'data.js');
    const source = fs.readFileSync(dataJsPath, 'utf8');

    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'data.js' });

    const data = sandbox.window.SupportData;
    if (!Array.isArray(data)) {
        throw new Error('data.js did not export a SupportData array via window.SupportData');
    }
    return data;
}

function toTicketDocument(t) {
    return {
        ticketId: t.id,
        subject: t.subject,
        category: t.category,
        priority: t.priority,
        status: t.status,
        assignedTo: t.assignedTo,
        customer: {
            name: t.customerName,
            company: t.company,
            email: t.email,
            phone: t.phone
        },
        createdAt: new Date(t.createdAt),
        lastUpdated: new Date(t.lastUpdated),
        slaDeadline: new Date(t.slaDeadline),
        aiAssist: {
            sentiment: t.sentiment,
            suggestedReply: null,
            recommendedAction: null
        },
        messages: t.messages.map(m => ({
            sender: m.sender,
            body: m.body,
            timestamp: new Date(m.timestamp)
        }))
    };
}

async function seedDB() {
    logger.info('Seeding started');

    const seedTickets = loadSupportData().map(toTicketDocument);

    await Ticket.deleteMany({});
    await Ticket.insertMany(seedTickets);

    logger.info('Seeding complete', { tickets: seedTickets.length });
}

module.exports = seedDB;
