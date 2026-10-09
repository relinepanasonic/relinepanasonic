// Workspaces: one app, separate data per workspace.
//   gobel = Panasonic Gobel          -> Postgres schema "public"  (existing data)
//   light = Panasonic Light Solution -> Postgres schema "ws_light" (own empty copy,
//                                       see Supabase Migration/50-workspaces.sql)
// The chosen workspace is kept in a session cookie ("ws") so every Supabase call
// (browser, server, API routes) reads/writes that workspace's schema only.

export type WorkspaceId = "gobel" | "light";

export const WORKSPACE_COOKIE = "ws";
export const DEFAULT_WORKSPACE: WorkspaceId = "gobel";

export const WORKSPACES: { id: WorkspaceId; name: string; schema: string; tagline: string }[] = [
  { id: "gobel", name: "Panasonic Gobel",          schema: "public",   tagline: "Panasonic Gobel dealer network" },
  { id: "light", name: "Panasonic Light Solution", schema: "ws_light", tagline: "Panasonic Light Solution business" },
];

export function isWorkspaceId(v: string | null | undefined): v is WorkspaceId {
  return v === "gobel" || v === "light";
}

export function workspaceById(id: string | null | undefined) {
  return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0];
}

export function schemaFor(id: string | null | undefined): string {
  return workspaceById(id).schema;
}

// Browser only: read the workspace id from document.cookie.
export function clientWorkspaceId(): WorkspaceId {
  if (typeof document === "undefined") return DEFAULT_WORKSPACE;
  const m = document.cookie.match(new RegExp("(?:^|; )" + WORKSPACE_COOKIE + "=([^;]*)"));
  const v = m ? decodeURIComponent(m[1]) : "";
  return isWorkspaceId(v) ? v : DEFAULT_WORKSPACE;
}
