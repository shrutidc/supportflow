const mongoose = require('mongoose');

const evaluationRunSchema = new mongoose.Schema({
    runId: { type: String, required: true, unique: true },
    startedAt: { type: Date, default: Date.now },
    completedAt: Date,
    status: {
        type: String,
        enum: ['running', 'completed', 'failed'],
        default: 'running'
    },
    totalTests: { type: Number, default: 0 },
    passed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    metrics: {
        categoryAccuracy: Number,
        priorityAccuracy: Number,
        escalationAccuracy: Number,
        groundednessScore: Number,
        hallucinationScore: Number,
        responseCompleteness: Number,
        avgLatencyMs: Number,
        overallPassRate: Number
    },
    testResults: [{
        testCaseId: String,
        agentType: String,
        input: mongoose.Schema.Types.Mixed,
        expectedOutput: mongoose.Schema.Types.Mixed,
        actualOutput: mongoose.Schema.Types.Mixed,
        passed: Boolean,
        latencyMs: Number,
        notes: String
    }]
});

module.exports = mongoose.model('EvaluationRun', evaluationRunSchema);
