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

const SLA_HOURS = { High: 4, Medium: 24, Low: 72 };

/**
 * How long work actually takes, in hours: [fastest, slowest] by priority.
 *
 * Ranges are set so roughly three quarters of completed work lands inside its
 * SLA. Wider ranges breached on 61% of closed tickets, which reads as a broken
 * system rather than a busy one. The story the seeded data tells is that work
 * which gets picked up is mostly on time, and it is the untriaged backlog that
 * breaches — which is what makes the SLA-risk view worth having.
 */
const HANDLING_HOURS = { High: [0.3, 5.2], Medium: [2, 31], Low: [6, 94] };

/**
 * Workflow state is derived from how old a ticket is and how long its priority
 * takes to handle, rather than drawn from a fixed mix.
 *
 * The distribution of arrivals is invented — the corpus carries no timestamps
 * — but it has to be *internally consistent*, because the analytics dashboard
 * computes resolution time, SLA compliance, and backlog age from these fields.
 * Two earlier shortcuts made those metrics meaningless: status was drawn
 * independently of age, so a 29-day-old ticket was as likely to be New as one
 * from this morning; and every resolved ticket closed exactly 45 minutes after
 * it opened, collapsing resolution time to a single spike. Charts built on
 * that look plausible and describe nothing.
 *
 * So: older tickets are more likely resolved, high priority is handled faster,
 * escalation concentrates in high priority, and a slice never resolves at all
 * — real queues always carry stuck work, and without it backlog age has no
 * tail worth plotting.
 */
function deriveWorkflow(row, seed, priority, ageHours) {
    // No reply to show means a worked ticket would render an empty thread.
    if (!row.answer || !row.answer.trim()) {
        return { status: 'New', assignedTo: null, closedAfterHours: null };
    }

    const [fastest, slowest] = HANDLING_HOURS[priority];
    // Tenths of an hour, so durations do not land on a coarse grid.
    const handlingHours = fastest + seededInt(seed + 'w', (slowest - fastest) * 10) / 10;

    // The modelled desk is running a backlog: a large minority of tickets are
    // never worked to completion. Without this, a 14-day window at this
    // arrival rate resolves almost everything — which is what a healthy desk
    // genuinely looks like, and leaves an inbox of 340 Closed tickets and one
    // New. A backlog is both common in practice and the condition that makes
    // SLA risk and escalation worth showing at all.
    const backlogged = seededInt(seed + 'k', 100) < 30;
    if (!backlogged && ageHours > handlingHours) {
        return { status: 'Closed', assignedTo: 'Support Team', closedAfterHours: handlingHours };
    }

    // Still open. Freshly arrived work has not been triaged yet.
    if (ageHours < 8) {
        return { status: 'New', assignedTo: null, closedAfterHours: null };
    }

    // Older open work splits between what is sitting untriaged and what
    // someone owns. Escalation concentrates in high priority.
    const roll = seededInt(seed + 'e', 100);
    if (roll < 32) {
        return { status: 'New', assignedTo: null, closedAfterHours: null };
    }
    const escalated = roll < (priority === 'High' ? 60 : 42);
    return escalated
        ? { status: 'Escalated', assignedTo: 'Engineering Queue', closedAfterHours: null }
        : { status: 'In Progress', assignedTo: 'Support Team', closedAfterHours: null };
}

function toTicket(row, index, organizationId) {
    const seed = `${index}:${row.subject}`;
    const priority = PRIORITY_MAP[String(row.priority || '').toLowerCase()] || 'Medium';

    // Arrivals spread across the last 14 days, in tenths of an hour. A wider
    // window at this volume leaves almost nothing open, since handling times
    // top out around 140 hours.
    const ageHours = seededInt(seed + 't', 14 * 24 * 10) / 10;
    const createdAt = new Date(Date.now() - ageHours * 3600 * 1000);

    const { status, assignedTo, closedAfterHours } = deriveWorkflow(row, seed, priority, ageHours);

    const messages = [{ sender: 'customer', body: row.body.trim(), timestamp: createdAt }];
    if (status !== 'New') {
        // A closed ticket's last reply is what closed it. An open one was
        // last touched partway through its handling time.
        const replyAfterHours =
            closedAfterHours ?? Math.min(ageHours, HANDLING_HOURS[priority][0]) / 2 + 0.5;
        messages.push({
            sender: 'agent',
            body: row.answer.trim(),
            timestamp: new Date(createdAt.getTime() + replyAfterHours * 3600 * 1000)
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
