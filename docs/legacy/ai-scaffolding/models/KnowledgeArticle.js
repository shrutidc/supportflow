const mongoose = require('mongoose');

const knowledgeArticleSchema = new mongoose.Schema({
    title: { type: String, required: true },
    problem: { type: String, required: true },
    rootCause: String,
    solution: { type: String, required: true },
    keywords: [String],
    sourceTicketId: String,
    category: {
        type: String,
        enum: ['Billing', 'Integration', 'Bug', 'Account Access', 'General']
    },
    embedding: [Number],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    views: { type: Number, default: 0 },
    helpfulness: { type: Number, default: 0 }
});

knowledgeArticleSchema.index({ title: 'text', problem: 'text', solution: 'text', keywords: 'text' });

module.exports = mongoose.model('KnowledgeArticle', knowledgeArticleSchema);
