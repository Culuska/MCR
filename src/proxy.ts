import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// First gate only: send visitors without a session cookie to the sign-in page.
// The real check (valid token, active user, role) runs again in every page and action.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("mcr_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
};
