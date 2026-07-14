const mongoose = require('mongoose');

const sentimentLogSchema = new mongoose.Schema({
    ticketId: { type: String, required: true },
    customerName: String,
    customerCompany: String,
    sentiment: {
        type: String,
        enum: ['Positive', 'Neutral', 'Frustrated', 'Angry', 'High-Risk']
    },
    score: { type: Number, min: -1, max: 1 },
    churnRisk: { type: Number, min: 0, max: 1 },
    analyzedAt: { type: Date, default: Date.now }
});

sentimentLogSchema.index({ ticketId: 1 });
sentimentLogSchema.index({ churnRisk: -1 });

module.exports = mongoose.model('SentimentLog', sentimentLogSchema);
