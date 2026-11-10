'use client';

import { PageBuilder } from './CMS';
import { useWorkspaceRouteStore } from './WorkspaceRouteContext';

export default function WorkspacePagesEntry() {
  const store = useWorkspaceRouteStore();
  return <PageBuilder key={`${store.locale}-${store.loaded}`} store={store}/>;
}
