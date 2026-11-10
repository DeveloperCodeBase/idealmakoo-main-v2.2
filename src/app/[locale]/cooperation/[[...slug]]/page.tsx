import {CooperationPage} from '@/components/site/Requests';
import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(withPublicPrefix(props,["cooperation"]));
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(withPublicPrefix(props,["cooperation"]),segments=><CooperationPage section={segments[1]}/>);
}
