const express = require('express');
const asyncHandler = require('../lib/async-handler');
const controller = require('../controllers/tickets.controller');

const router = express.Router();

router.get('/', asyncHandler(controller.list));
router.get('/:ticketId', asyncHandler(controller.get));
router.patch('/:ticketId', asyncHandler(controller.update));
router.post('/:ticketId/messages', asyncHandler(controller.addMessage));

module.exports = router;
