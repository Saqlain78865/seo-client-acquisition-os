import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

// The Google sign-in callback is reached from the system browser (no app cookie); it checks its own
// signed state and that the person who started the sign-in is an owner or admin.
const PUBLIC_PATHS = ["/login", "/register", "/p/", "/api/webhooks/", "/api/health", "/api/integrations/google/callback"];
const REQUEST_ID = "x-request-id";

// Every request gets a correlation id: forwarded to server code (logs, error references) and
// returned in the response header. An id from a trusted load balancer is kept if it looks sane.
function requestId(request: NextRequest) {
  const incoming = request.headers.get(REQUEST_ID);
  return incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
}

function tag<T extends NextResponse>(response: T, id: string) {
  response.headers.set(REQUEST_ID, id);
  return response;
}

// Optimistic check only: the session is fully validated against the database in the
// app layout and in every server action / route handler.
export function proxy(request: NextRequest) {
  const id = requestId(request);
  const { pathname } = request.nextUrl;
  const pass = () => {
    const headers = new Headers(request.headers);
    headers.set(REQUEST_ID, id);
    return tag(NextResponse.next({ request: { headers } }), id);
  };
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) return pass();
  if (!request.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/")) {
      return tag(NextResponse.json({ error: "Unauthorized" }, { status: 401 }), id);
    }
    return tag(NextResponse.redirect(new URL("/login", request.url)), id);
  }
  return pass();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
