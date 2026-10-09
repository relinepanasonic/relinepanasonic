"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_WORKSPACE, clientWorkspaceId, workspaceById, type WorkspaceId } from "./workspace";

// The workspace cookie only exists in the browser. useSyncExternalStore gives
// React the default for the server render and the real value on the client,
// without a hydration mismatch (and without setState-in-effect).
const subscribe = () => () => {};

export function useWorkspaceId(): WorkspaceId {
  return useSyncExternalStore(subscribe, clientWorkspaceId, () => DEFAULT_WORKSPACE);
}

export function useWorkspace() {
  return workspaceById(useWorkspaceId());
}
