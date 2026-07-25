const mongoose = require('mongoose');

/**
 * A workspace (tenant). Mirrors a Clerk organization.
 *
 * Clerk owns identity, membership, and roles; this record exists so
 * application data can be joined and scoped locally without a network call
 * to Clerk on every request, and so we have somewhere to hang app-specific
 * settings that Clerk knows nothing about.
 */
const organizationSchema = new mongoose.Schema(
    {
        // Clerk organization id (org_...). The tenancy key for all data.
        clerkOrgId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        name: { type: String, required: true },
        slug: { type: String },
        plan: {
            type: String,
            enum: ['starter', 'growth', 'enterprise'],
            default: 'starter'
        },
        settings: {
            // Hours until the SLA deadline for a newly escalated ticket.
            escalationSlaHours: { type: Number, default: 4 }
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Organization', organizationSchema);
