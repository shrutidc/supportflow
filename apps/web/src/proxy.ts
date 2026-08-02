import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Next 16 renamed `middleware` to `proxy`; the runtime is always nodejs.
// Everything except the auth screens requires a signed-in user.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

/**
 * The redirect is written out explicitly rather than delegating to
 * `auth.protect()`.
 *
 * `auth.protect()` decides for itself what an unauthenticated request
 * deserves, and that decision differed by environment: locally it issued a
 * 307 to /sign-in, while on Vercel every prerendered page answered 404
 * (`x-matched-path: /404`) — a signed-out visitor saw a dead site rather than
 * a login screen. Choosing the response here removes the ambiguity, and
 * behaves the same in both places.
 *
 * API routes are excluded on purpose: an unauthenticated fetch should get a
 * 401 from the route handler, not an HTML login page it cannot use.
 */
export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request) || request.nextUrl.pathname.startsWith("/api/")) {
    return;
  }

  const { userId } = await auth();
  if (userId) {
    return;
  }

  const signInUrl = request.nextUrl.clone();
  signInUrl.pathname = "/sign-in";
  signInUrl.search = "";
  signInUrl.searchParams.set("redirect_url", request.nextUrl.href);
  return NextResponse.redirect(signInUrl);
});

export const config = {
  matcher: [
    // Everything except Next internals and static files...
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // ...plus API routes, which must be protected too.
    "/(api|trpc)(.*)",
  ],
};
