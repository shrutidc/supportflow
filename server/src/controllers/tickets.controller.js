const ticketService = require('../services/ticket.service');

/**
 * HTTP layer: translate requests to service calls and results to responses.
 *
 * Inputs arrive pre-validated (req.validated) from the Zod middleware and
 * pre-authenticated (req.auth) from the auth middleware. Note that the
 * organization is taken from req.auth — never from the request body.
 */

async function list(req, res) {
    const { status, q, view, sort, limit } = req.validated.query;
    const tickets = await ticketService.listTickets({ status, q, view, sort, limit }, req.auth);
    res.json({ tickets });
}

async function get(req, res) {
    const ticket = await ticketService.getTicket(req.params.ticketId, req.auth);
    res.json(ticket);
}

async function claim(req, res) {
    const ticket = await ticketService.claimTicket(req.params.ticketId, req.auth);
    res.json(ticket);
}

async function update(req, res) {
    const ticket = await ticketService.updateTicket(
        req.params.ticketId,
        req.validated.body,
        req.auth
    );
    res.json(ticket);
}

async function addMessage(req, res) {
    const ticket = await ticketService.addMessage(
        req.params.ticketId,
        req.validated.body,
        req.auth
    );
    res.json(ticket);
}

module.exports = { list, get, claim, update, addMessage };
