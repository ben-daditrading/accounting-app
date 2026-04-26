import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";

export function getAllowedEmailDomain() {
  return (process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "daditrading.com").toLowerCase();
}

export function isAllowedEmail(email: string | null | undefined) {
  if (!email) {
    return false;
  }

  return email.toLowerCase().endsWith(`@${getAllowedEmailDomain()}`);
}

export async function getAuthorizedUser() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { user: null, allowed: false };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    user,
    allowed: isAllowedEmail(user?.email),
  };
}
