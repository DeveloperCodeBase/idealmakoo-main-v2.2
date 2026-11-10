import 'server-only';
import type {ReactNode} from 'react';
import Workspace from '@/components/workspace/Workspace';

/** Supply code references and the validated route only. The client guards and
 * current authorized workspace response remain responsible for private data. */
export function renderWorkspaceRoute(segments:string[],body?:ReactNode){
  return <Workspace section={segments.slice(1).join('/')} body={body}/>;
}
