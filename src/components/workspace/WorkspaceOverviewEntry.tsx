'use client';

import dynamic from 'next/dynamic';
import {demoMode} from '@/lib/api';
import { Overview } from './Overview';
import { useWorkspaceRouteStore } from './WorkspaceRouteContext';

const OperationsInsights=dynamic(()=>import('./OperationsInsights'));

export default function WorkspaceOverviewEntry() {
  const store = useWorkspaceRouteStore();
  return <><Overview store={store}/>{!demoMode&&<OperationsInsights key={`${store.actorId}:${store.locale}`} store={store}/>}</>;
}
