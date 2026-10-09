import { createClient } from "@supabase/supabase-js";

// Service-role client — SERVER ONLY. Bypasses RLS.
// Use only in trusted server code (e.g. upload API after verifying the user).
// `schema` = the workspace's Postgres schema (await currentSchema() from
// lib/workspace-server). Omit it for shared tables (profiles, invites, auth).
export function createAdminClient(schema: string = "public") {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false }, db: { schema } }
  );
}
