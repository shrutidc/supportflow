const express = require('express');
const asyncHandler = require('../lib/async-handler');
const validate = require('../middleware/validate');
const controller = require('../controllers/tickets.controller');
const {
    patchTicketSchema,
    addMessageSchema,
    listQuerySchema
} = require('../validators/ticket.validators');

const router = express.Router();

router.get('/', validate(listQuerySchema, 'query'), asyncHandler(controller.list));
router.get('/:ticketId', asyncHandler(controller.get));

// Claiming is taking ownership of an unassigned ticket for yourself, so it
// carries no body — the owner is the authenticated caller.
router.post('/:ticketId/claim', asyncHandler(controller.claim));

router.patch('/:ticketId', validate(patchTicketSchema, 'body'), asyncHandler(controller.update));
router.post(
    '/:ticketId/messages',
    validate(addMessageSchema, 'body'),
    asyncHandler(controller.addMessage)
);

module.exports = router;
