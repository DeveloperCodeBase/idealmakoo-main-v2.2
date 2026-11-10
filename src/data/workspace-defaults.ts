import type { WorkspaceState } from '@/data/workspace-seed';

/** Each caller owns its settings; demo and production share only the defaults. */
export function createWorkspaceSettings(): WorkspaceState['settings'] {
  return { name: 'Ideal Makoo', apiUrl: '/api/v1', defaultLocale: 'fa', compact: false, email: 'info@idealmakoo.com' };
}

/** Production starts empty until the current actor's authorized snapshot loads. */
export function createEmptyWorkspaceState(): WorkspaceState {
  return { version: 1, records: [], pages: [], media: [], audit: [], aiJobs: [], forms: [], settings: createWorkspaceSettings() };
}
