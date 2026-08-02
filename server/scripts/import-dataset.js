/**
 * Imports demo tickets from the labelled Kaggle support dataset.
 *
 *   node scripts/import-dataset.js --org-id=org_xxx [--limit=400] [--dry-run]
 *
 * Why only a few hundred rows: Atlas M0 caps at 512MB, and a few hundred
 * tickets already reads as a working support desk. The full 136k rows are for
 * the notebooks and the evaluation harness, which read the CSV directly and
 * never need it in the database.
 *
 * The dataset's human `type`, `queue`, and `priority` labels are preserved on
 * each ticket under `datasetLabels` — that is the ground truth the AI triage
 * evaluation scores against, so it must survive later edits to the working
 * fields.
 *
 * Raw CSVs are gitignored. Point --csv at your own copy if it lives elsewhere.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const env = require('../src/config/env');
const logger = require('../src/lib/logger');
const Ticket = require('../models/Ticket');
const Organization = require('../models/Organization');

const DEFAULT_CSV = path.join(
    __dirname,
    '..',
    '..',
    'customer_support',
    'dataset-tickets-multi-lang-4-20k.csv'
);

const PRIORITY_MAP = { low: 'Low', medium: 'Medium', high: 'High' };

/** Synthetic customers — the dataset ships no identities, and inventing a
 *  small recurring cast makes "this customer's other tickets" meaningful. */
const COMPANIES = [
    ['Northwind Analytics', 'northwind.io'],
    ['Lumen Retail', 'lumenretail.com'],
    ['Parallel Freight', 'parallelfreight.co'],
    ['Aster Health', 'asterhealth.org'],
    ['Bluepeak Studios', 'bluepeak.studio'],
    ['Cobalt Logistics', 'cobalt-logistics.com'],
    ['Fernway Education', 'fernway.edu'],
    ['Sable Financial', 'sablefin.com']
];
const FIRST = ['Amara', 'Devin', 'Priya', 'Tomas', 'Ingrid', 'Kwame', 'Lena', 'Rafael', 'Yuki', 'Noor'];
const LAST = ['Okafor', 'Reyes', 'Nair', 'Vance', 'Holm', 'Mensah', 'Brandt', 'Costa', 'Sato', 'Haddad'];

/**
 * Deterministic pseudo-randomness: the same row always yields the same
 * customer and timestamps, so re-running the import does not reshuffle the
 * demo workspace and invalidate screenshots.
 */
function seededInt(seed, max) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return Math.abs(h) % max;
}

function buildCustomer(seed) {
    const [company, domain] = COMPANIES[seededInt(seed + 'c', COMPANIES.length)];
    const first = FIRST[seededInt(seed + 'f', FIRST.length)];
    const last = LAST[seededInt(seed + 'l', LAST.length)];
    return {
        name: `${first} ${last}`,
        company,
        email: `${first}.${last}`.toLowerCase() + `@${domain}`
    };
}

/**
 * Status is drawn from a fixed mix rather than inferred from whether the row
 * has an agent answer. Almost every row in the dataset does, so inferring it
 * produced an inbox that was 58% Closed with four open tickets — an accurate
 * reflection of the corpus and a useless demo, since a support queue with no
 * live work in it is the one thing an inbox should never look like.
 *
 * A ticket only carries the agent's reply once it has left New, so the
 * conversation still matches the state.
 */
const STATUS_MIX = [
    { status: 'New', assignedTo: null, upTo: 22 },
    { status: 'In Progress', assignedTo: 'Support Team', upTo: 54 },
    { status: 'Escalated', assignedTo: 'Engineering Queue', upTo: 66 },
    { status: 'Closed', assignedTo: 'Support Team', upTo: 100 }
];

function deriveWorkflow(row, seed) {
    // Without a reply to show, a worked ticket would render as an empty
    // thread, so those stay New regardless of the roll.
    if (!row.answer || !row.answer.trim()) {
        return { status: 'New', assignedTo: null };
    }
    const roll = seededInt(seed + 's', 100);
    return STATUS_MIX.find(s => roll < s.upTo);
}

const SLA_HOURS = { High: 4, Medium: 24, Low: 72 };

function toTicket(row, index, organizationId) {
    const seed = `${index}:${row.subject}`;
    const priority = PRIORITY_MAP[String(row.priority || '').toLowerCase()] || 'Medium';
    const { status, assignedTo } = deriveWorkflow(row, seed);

    // Spread arrivals across the last 30 days so backlog-age and volume
    // charts have a real distribution instead of one spike.
    const ageMinutes = seededInt(seed + 't', 30 * 24 * 60);
    const createdAt = new Date(Date.now() - ageMinutes * 60 * 1000);

    const messages = [{ sender: 'customer', body: row.body.trim(), timestamp: createdAt }];
    if (status !== 'New') {
        messages.push({
            sender: 'agent',
            body: row.answer.trim(),
            timestamp: new Date(createdAt.getTime() + 45 * 60 * 1000)
        });
    }

    const lastUpdated = messages[messages.length - 1].timestamp;

    return {
        organizationId,
        ticketId: `SF-${2000 + index}`,
        subject: row.subject.trim(),
        category: row.type || 'Request',
        queue: row.queue || null,
        priority,
        status,
        assignedTo,
        assignedToUserId: null,
        customer: buildCustomer(seed),
        createdAt,
        lastUpdated,
        slaDeadline: new Date(createdAt.getTime() + SLA_HOURS[priority] * 3600 * 1000),
        datasetLabels: {
            type: row.type || null,
            queue: row.queue || null,
            priority: row.priority || null
        },
        messages
    };
}

/** Minimal RFC-4180 parser: the bodies contain commas, quotes and newlines. */
async function readCsv(file) {
    const text = await fs.promises.readFile(file, 'utf8');
    const rows = [];
    let field = '';
    let record = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            record.push(field);
            field = '';
        } else if (ch === '\n') {
            record.push(field.replace(/\r$/, ''));
            rows.push(record);
            record = [];
            field = '';
        } else {
            field += ch;
        }
    }
    if (field || record.length) {
        record.push(field);
        rows.push(record);
    }

    const header = rows.shift();
    return rows
        .filter(r => r.length === header.length)
        .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function parseArgs(argv) {
    const args = { orgId: null, limit: 400, dryRun: false, csv: DEFAULT_CSV };
    for (const a of argv.slice(2)) {
        if (a === '--dry-run') args.dryRun = true;
        else if (a.startsWith('--org-id=')) args.orgId = a.slice(9);
        else if (a.startsWith('--limit=')) args.limit = parseInt(a.slice(8), 10);
        else if (a.startsWith('--csv=')) args.csv = a.slice(6);
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv);

    if (!args.orgId) {
        logger.error('--org-id is required (the Clerk organization to import into)');
        process.exit(1);
    }
    if (!fs.existsSync(args.csv)) {
        logger.error('CSV not found', { path: args.csv, hint: 'pass --csv=<path>' });
        process.exit(1);
    }
    if (!env.mongoUri) {
        logger.error('MONGODB_URI is not set');
        process.exit(1);
    }

    const all = await readCsv(args.csv);

    // English only: the demo is English, and a German inbox would read as a
    // bug rather than as multilingual support.
    const usable = all.filter(
        r => r.language === 'en' && r.subject && r.subject.trim() && r.body && r.body.trim()
    );
    const selected = usable.slice(0, args.limit);

    logger.info('Dataset read', {
        totalRows: all.length,
        englishUsable: usable.length,
        selected: selected.length
    });

    const docs = selected.map((row, i) => toTicket(row, i, args.orgId));

    if (args.dryRun) {
        logger.info('Dry run — nothing written', {
            sample: { ...docs[0], messages: `${docs[0].messages.length} message(s)` }
        });
        return;
    }

    await mongoose.connect(env.mongoUri);

    await Organization.updateOne(
        { clerkOrgId: args.orgId },
        { $setOnInsert: { clerkOrgId: args.orgId, name: 'Demo Workspace', plan: 'starter' } },
        { upsert: true }
    );

    // Replace only what this importer owns. Hand-authored tickets (SF-1xxx)
    // in the same workspace are left alone.
    const removed = await Ticket.deleteMany({
        organizationId: args.orgId,
        ticketId: { $regex: '^SF-2' }
    });
    await Ticket.insertMany(docs);

    logger.info('Import complete', {
        organizationId: args.orgId,
        removed: removed.deletedCount,
        inserted: docs.length
    });

    await mongoose.disconnect();
}

main().catch(err => {
    logger.error('Import failed', { error: err.message, stack: err.stack });
    process.exit(1);
});
