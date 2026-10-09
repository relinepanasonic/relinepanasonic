import { cookies } from "next/headers";
import { DEFAULT_WORKSPACE, WORKSPACE_COOKIE, isWorkspaceId, schemaFor, type WorkspaceId } from "./workspace";

// Server only (route handlers / server components): the active workspace.
export async function currentWorkspaceId(): Promise<WorkspaceId> {
  const v = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return isWorkspaceId(v) ? v : DEFAULT_WORKSPACE;
}

export async function currentSchema(): Promise<string> {
  return schemaFor(await currentWorkspaceId());
}
