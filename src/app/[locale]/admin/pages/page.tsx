import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';
import {renderWorkspaceRoute} from '@/server/workspace-route';
import WorkspacePagesEntry from '@/components/workspace/WorkspacePagesEntry';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(withPublicPrefix(props,['admin','pages']));
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(withPublicPrefix(props,['admin','pages']),segments=>renderWorkspaceRoute(segments,<WorkspacePagesEntry/>));
}
