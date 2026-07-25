const mongoose = require('mongoose');

/**
 * A local mirror of a Clerk user, upserted on authenticated requests.
 *
 * Purpose is display and querying only: rendering "assigned to Alex Kim"
 * or filtering "assigned to me" should not require a Clerk API call per
 * ticket. Clerk remains the source of truth for identity — nothing here is
 * used for authentication or authorization decisions.
 *
 * Deliberately NOT scoped to an organization: one human is one User record
 * and may belong to several organizations. Membership and role live in
 * Clerk and arrive on the session; see docs/architecture/phase-3-auth.md.
 */
const userSchema = new mongoose.Schema(
    {
        clerkUserId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        name: { type: String },
        email: { type: String },
        avatarUrl: { type: String }
    },
    { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
