// Workspaces: one app, separate data per workspace.
//   gobel = Reline Project 1.0       -> Postgres schema "public"  (existing data; was "Panasonic Gobel")
//   light = Panasonic Light Solution -> Postgres schema "ws_light" (own empty copy,
//                                       see Supabase Migration/50-workspaces.sql)
//   alpha = Alpha Project            -> Postgres schema "ws_alpha" (own empty copy,
//                                       see Supabase Migration/53-workspace-alpha.sql)
// The chosen workspace is kept in a session cookie ("ws") so every Supabase call
// (browser, server, API routes) reads/writes that workspace's schema only.

export type WorkspaceId = "gobel" | "light" | "alpha";

export const WORKSPACE_COOKIE = "ws";
export const DEFAULT_WORKSPACE: WorkspaceId = "gobel";

export const WORKSPACES: { id: WorkspaceId; name: string; schema: string; tagline: string }[] = [
  { id: "gobel", name: "Reline Project 1.0",        schema: "public",   tagline: "Reline Project 1.0 dealer network" },
  { id: "light", name: "Panasonic Light Solution", schema: "ws_light", tagline: "Panasonic Light Solution business" },
  { id: "alpha", name: "Alpha Project",            schema: "ws_alpha", tagline: "Alpha Project" },
];

// Pages that do not exist in a workspace (hidden from the menu, direct links go back to the dashboard).
// Reline Project 1.0 (gobel) keeps its original app: Earning, Demographic and Payout are for the newer workspaces.
const HIDDEN_PAGES: Record<WorkspaceId, string[]> = {
  gobel: ["/finance", "/operational", "/payout"],
  light: [],
  alpha: [],
};
export function isPageHidden(id: string | null | undefined, path: string): boolean {
  const ws = isWorkspaceId(id) ? id : DEFAULT_WORKSPACE;
  return HIDDEN_PAGES[ws].some((h) => path === h || path.startsWith(h + "/"));
}

export function isWorkspaceId(v: string | null | undefined): v is WorkspaceId {
  return v === "gobel" || v === "light" || v === "alpha";
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
