import type { NextConfig } from "next";

// Express API base URL (used by the dev/prod server for proxying, never
// exposed to the browser). In dev the API runs on :3000 and this app on
// :3001; the browser only ever calls same-origin /api/*, so no CORS setup
// is needed on either side.
const API_URL = process.env.API_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
