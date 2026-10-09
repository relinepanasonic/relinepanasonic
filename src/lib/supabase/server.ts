import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { WORKSPACE_COOKIE, schemaFor } from "@/lib/workspace";

// Server-side Supabase client (anon key + user session from cookies).
// RLS still applies — this acts as the logged-in user.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Reads/writes the active workspace's schema (cookie set on /welcome).
      db: { schema: schemaFor(cookieStore.get(WORKSPACE_COOKIE)?.value) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware refreshes.
          }
        },
      },
    }
  );
}
