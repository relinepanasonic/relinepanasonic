"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function Nav({ role }: { role?: string }) {
  const router = useRouter();
  const canUpload = role === "superadmin" || role === "client_admin";

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="flex items-center justify-between border-b bg-white px-6 py-3">
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="font-semibold">Dashboard</Link>
        {canUpload && <Link href="/upload" className="text-gray-600 hover:text-gray-900">Upload</Link>}
      </nav>
      <button onClick={signOut} className="text-sm text-gray-500 hover:text-gray-900">
        Sign out
      </button>
    </header>
  );
}
