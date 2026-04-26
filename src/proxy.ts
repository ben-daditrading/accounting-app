import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/auth/access";

function isPublicPath(pathname: string) {
  return pathname === "/login" || pathname.startsWith("/auth/callback");
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({
    request,
  });

  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";

  const allowed = isAllowedEmail(user?.email);

  if (!isPublicPath(pathname) && !allowed) {
    loginUrl.searchParams.set("next", pathname);
    if (user) {
      loginUrl.searchParams.set("error", "unauthorized_domain");
    }
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && user && !allowed && request.nextUrl.searchParams.get("error") !== "unauthorized_domain") {
    loginUrl.searchParams.set("error", "unauthorized_domain");
    return NextResponse.redirect(loginUrl);
  }

  if (pathname === "/login" && allowed) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/transactions";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
