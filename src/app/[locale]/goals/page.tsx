import {CompanyContent} from '@/components/content/CompanyContent';
import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(withPublicPrefix(props,["goals"]));
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(withPublicPrefix(props,["goals"]),segments=><CompanyContent section="goals"/>);
}
