"use client";

import { createBrowserClient } from "@supabase/ssr";
import { clientWorkspaceId, schemaFor } from "@/lib/workspace";

// Browser-side Supabase client (anon key). RLS enforces what the user can see.
// Reads/writes the ACTIVE WORKSPACE's schema (see lib/workspace.ts). Switching
// workspace is a full page load, so this client is always built fresh for it.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: schemaFor(clientWorkspaceId()) } }
  );
}
