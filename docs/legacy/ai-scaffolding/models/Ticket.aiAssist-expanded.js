const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: String,
        enum: ['customer', 'agent'],
        required: true
    },
    body: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const ticketSchema = new mongoose.Schema({
    ticketId: {
        type: String,
        required: true,
        unique: true
    },
    subject: {
        type: String,
        required: true
    },
    category: {
        type: String,
        enum: ['Billing', 'Integration', 'Bug', 'Account Access'],
        required: true
    },
    priority: {
        type: String,
        enum: ['Low', 'Medium', 'High'],
        required: true
    },
    status: {
        type: String,
        enum: ['New', 'In Progress', 'Escalated', 'Closed'],
        required: true
    },
    assignedTo: {
        type: String,
        default: null
    },
    customer: {
        name: { type: String, required: true },
        company: { type: String },
        email: { type: String },
        phone: { type: String }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    slaDeadline: {
        type: Date,
        required: true
    },
    aiAssist: {
        sentiment: {
            type: String,
            enum: ['Frustrated', 'Neutral', 'Positive', 'Angry', 'High-Risk']
        },
        suggestedReply: { type: String },
        recommendedAction: { type: String },

        // AI Summary
        summary: { type: String },

        // Triage Agent output
        triageResult: {
            priority: String,
            category: String,
            urgency: { type: String, enum: ['Critical', 'High', 'Medium', 'Low'] },
            confidence: Number,
            reasoning: String,
            slaRisk: Boolean,
            shouldEscalate: Boolean,
            processedAt: Date
        },

        // Duplicate Agent output
        duplicates: [{
            ticketId: String,
            similarity: Number,
            summary: String
        }],

        // Routing Agent output
        routingResult: {
            team: { type: String, enum: ['Backend', 'Frontend', 'Infrastructure', 'Billing', 'Authentication', 'API', 'Machine Learning'] },
            reasoning: String,
            confidence: Number
        },

        // Sentiment history
        sentimentHistory: [{
            label: String,
            score: Number,
            churnRisk: Number,
            analyzedAt: Date
        }],

        // Linked knowledge articles
        knowledgeArticles: [{
            articleId: { type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeArticle' },
            title: String,
            relevanceScore: Number
        }],

        // Resolution Agent output
        resolutionResult: {
            suggestedReply: String,
            troubleshootingChecklist: [String],
            nextQuestions: [String],
            potentialRootCause: String,
            confidence: Number
        },

        // Timestamps
        lastAnalyzedAt: Date
    },
    messages: [messageSchema]
});

// Text index for search
ticketSchema.index({ subject: 'text' });

module.exports = mongoose.model('Ticket', ticketSchema);
