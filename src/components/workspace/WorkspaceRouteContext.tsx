'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { WorkspaceStore } from './store';

const WorkspaceRouteContext = createContext<WorkspaceStore | null>(null);

// Only the already authorized Workspace mounts this provider. A server-selected
// feature reference contains code, never a store snapshot or an actor/session.
export function WorkspaceRouteStoreProvider({ store, children }: { store: WorkspaceStore; children: ReactNode }) {
  return <WorkspaceRouteContext.Provider value={store}>{children}</WorkspaceRouteContext.Provider>;
}

export function useWorkspaceRouteStore(): WorkspaceStore {
  const store = useContext(WorkspaceRouteContext);
  if (!store) throw new Error('Workspace route features require the current authorized workspace store.');
  return store;
}
