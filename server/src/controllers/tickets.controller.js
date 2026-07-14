const ticketService = require('../services/ticket.service');

/**
 * HTTP layer: translate requests to service calls and service results
 * to responses. Inputs arrive pre-validated (req.validated) from the
 * Zod middleware; wire contract is unchanged from the pre-refactor API.
 */

async function list(req, res) {
    const { status, q, view, sort, limit } = req.validated.query;
    const tickets = await ticketService.listTickets({ status, q, view, sort, limit });
    res.json({ tickets });
}

async function get(req, res) {
    const ticket = await ticketService.getTicket(req.params.ticketId);
    res.json(ticket);
}

async function update(req, res) {
    const ticket = await ticketService.updateTicket(req.params.ticketId, req.validated.body);
    res.json(ticket);
}

async function addMessage(req, res) {
    const ticket = await ticketService.addMessage(req.params.ticketId, req.validated.body);
    res.json(ticket);
}

module.exports = { list, get, update, addMessage };
