import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';
import {renderWorkspaceRoute} from '@/server/workspace-route';
import WorkspaceOverviewEntry from '@/components/workspace/WorkspaceOverviewEntry';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(withPublicPrefix(props,['admin']));
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(withPublicPrefix(props,['admin']),segments=>renderWorkspaceRoute(segments,<WorkspaceOverviewEntry/>));
}
