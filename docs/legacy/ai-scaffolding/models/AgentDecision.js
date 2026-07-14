const mongoose = require('mongoose');

const agentDecisionSchema = new mongoose.Schema({
    ticketId: { type: String, required: true },
    agentType: {
        type: String,
        enum: ['triage', 'duplicate', 'resolution', 'routing', 'sentiment', 'knowledge', 'summary', 'weekly'],
        required: true
    },
    input: mongoose.Schema.Types.Mixed,
    output: mongoose.Schema.Types.Mixed,
    confidence: Number,
    reasoning: String,
    latencyMs: Number,
    modelUsed: String,
    createdAt: { type: Date, default: Date.now }
});

agentDecisionSchema.index({ ticketId: 1, agentType: 1 });

module.exports = mongoose.model('AgentDecision', agentDecisionSchema);
