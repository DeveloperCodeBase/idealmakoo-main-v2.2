'use client';
import {useMemo} from 'react';
import {useApp} from '@/components/providers/AppProvider';
import {demoMode} from '@/lib/api';
import {canViewRequest} from './portal-data';
import {RequestsPanel} from './AccountRequests';

/** Preload this route's code without serializing a session or request records. */
export default function AccountRequestsEntry({section}:{section:string}){
  const {requests,session}=useApp();
  const ownRequests=useMemo(()=>demoMode?requests.filter(request=>canViewRequest(request,session)):requests,[requests,session]);
  return <RequestsPanel requests={ownRequests} section={section}/>;
}
