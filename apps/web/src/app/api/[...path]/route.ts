import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

/**
 * Authenticated proxy to the Express API.
 *
 * This replaces a plain next.config rewrite. A rewrite forwards the browser's
 * cookies, which happens to work when both services share a hostname in local
 * development and silently fails in production, where the frontend (Vercel)
 * and API (Railway) sit on different domains. Instead we mint a short-lived
 * Clerk session token server-side and send it as a bearer token, which works
 * identically in both environments.
 *
 * The browser never sees this token, and never talks to the API directly.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3000";

// Hop-by-hop and host-specific headers must not be forwarded verbatim.
const STRIPPED_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "cookie",
  "authorization",
]);

async function handler(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { userId, getToken } = await auth();

  if (!userId) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const token = await getToken();
  if (!token) {
    return Response.json({ error: "Could not obtain a session token" }, { status: 401 });
  }

  const { path } = await ctx.params;
  const search = request.nextUrl.search;
  const target = `${API_URL}/api/${path.map(encodeURIComponent).join("/")}${search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Authorization", `Bearer ${token}`);

  // A shared secret, when the deployment also sits behind the API_TOKEN gate.
  if (process.env.API_TOKEN) {
    headers.set("X-Api-Token", process.env.API_TOKEN);
  }

  const hasBody = !["GET", "HEAD"].includes(request.method);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    // The API being unreachable is an infrastructure fault, not a client error.
    return Response.json({ error: "Support API is unavailable" }, { status: 502 });
  }
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
