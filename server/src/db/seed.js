const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Ticket = require('../../models/Ticket');
const Organization = require('../../models/Organization');
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

function toTicketDocument(t, organizationId) {
    return {
        organizationId,
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

/**
 * Organization that owns demo data when no real Clerk org is supplied.
 * Used by local development, the in-memory fallback, and tests.
 */
const DEMO_ORG_ID = process.env.DEMO_ORG_ID || 'org_demo_supportflow';

/**
 * Seeds the demo dataset into one organization, replacing only that
 * organization's tickets — other tenants' data is never touched.
 */
async function seedDB(organizationId = DEMO_ORG_ID) {
    logger.info('Seeding started', { organizationId });

    const seedTickets = loadSupportData().map(t => toTicketDocument(t, organizationId));

    await Organization.updateOne(
        { clerkOrgId: organizationId },
        { $setOnInsert: { clerkOrgId: organizationId, name: 'Demo Workspace' } },
        { upsert: true }
    );

    await Ticket.deleteMany({ organizationId });
    await Ticket.insertMany(seedTickets);

    logger.info('Seeding complete', { tickets: seedTickets.length, organizationId });
}

module.exports = seedDB;
module.exports.DEMO_ORG_ID = DEMO_ORG_ID;
