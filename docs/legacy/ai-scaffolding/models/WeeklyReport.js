const mongoose = require('mongoose');

const weeklyReportSchema = new mongoose.Schema({
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    generatedAt: { type: Date, default: Date.now },
    summary: String,
    metrics: {
        totalTickets: Number,
        resolved: Number,
        escalated: Number,
        avgResolutionHours: Number,
        slaBreaches: Number,
        customerSatisfaction: Number
    },
    topIssues: [{
        category: String,
        count: Number,
        trend: { type: String, enum: ['up', 'down', 'stable'] }
    }],
    escalationTrends: String,
    knowledgeGaps: [String],
    recommendations: [String],
    supportHealthScore: { type: Number, min: 0, max: 100 }
});

module.exports = mongoose.model('WeeklyReport', weeklyReportSchema);
