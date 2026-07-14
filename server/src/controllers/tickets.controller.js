const ticketService = require('../services/ticket.service');

/**
 * HTTP layer: translate requests to service calls and service results
 * to responses. Wire contract is unchanged from the pre-refactor API.
 */

async function list(req, res) {
    const { status, q, view, sort } = req.query;

    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;

    const tickets = await ticketService.listTickets({ status, q, view, sort, limit });
    res.json({ tickets });
}

async function get(req, res) {
    const ticket = await ticketService.getTicket(req.params.ticketId);
    res.json(ticket);
}

async function update(req, res) {
    const ticket = await ticketService.updateTicket(req.params.ticketId, req.body);
    res.json(ticket);
}

async function addMessage(req, res) {
    const ticket = await ticketService.addMessage(req.params.ticketId, req.body);
    res.json(ticket);
}

module.exports = { list, get, update, addMessage };
