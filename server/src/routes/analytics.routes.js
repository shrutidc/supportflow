const express = require('express');
const asyncHandler = require('../lib/async-handler');
const validate = require('../middleware/validate');
const controller = require('../controllers/analytics.controller');
const { overviewQuerySchema } = require('../validators/analytics.validators');

const router = express.Router();

router.get('/overview', validate(overviewQuerySchema, 'query'), asyncHandler(controller.overview));

module.exports = router;
