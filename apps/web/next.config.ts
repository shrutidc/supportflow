import type { NextConfig } from "next";

// Requests to /api/* are handled by src/app/api/[...path]/route.ts, which
// attaches the caller's Clerk session token before forwarding to the Express
// API. A plain rewrite is deliberately not used — it cannot authenticate.
const nextConfig: NextConfig = {};

export default nextConfig;
