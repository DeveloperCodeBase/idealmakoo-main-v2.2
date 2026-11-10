import {EditorialCenter} from '@/components/content/EditorialCenter';
import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(withPublicPrefix(props,["careers"]));
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(withPublicPrefix(props,["careers"]),segments=><EditorialCenter section="careers" slug={segments[1]}/>);
}
