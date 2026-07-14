const { z } = require('zod');

/**
 * Request validation schemas.
 *
 * PATCH is a strict field whitelist: unknown keys are stripped so a
 * client can never mass-assign fields like ticketId, aiAssist, or
 * timestamps (previously $set spread the entire request body).
 */

const STATUSES = ['New', 'In Progress', 'Escalated', 'Closed'];
const PRIORITIES = ['Low', 'Medium', 'High'];

const patchTicketSchema = z
    .object({
        status: z.enum(STATUSES).optional(),
        priority: z.enum(PRIORITIES).optional(),
        assignedTo: z.string().trim().min(1).max(120).nullable().optional()
    })
    .refine(data => Object.keys(data).length > 0, {
        message: 'No updatable fields provided (allowed: status, priority, assignedTo)'
    });

const addMessageSchema = z.object({
    sender: z.enum(['customer', 'agent']),
    body: z.string().trim().min(1, 'Message body must not be empty').max(10000)
});

const listQuerySchema = z.object({
    status: z.string().max(40).optional(),
    q: z.string().max(200).optional(),
    view: z.string().max(40).optional(),
    sort: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(200).catch(50).default(50)
});

module.exports = { patchTicketSchema, addMessageSchema, listQuerySchema };
