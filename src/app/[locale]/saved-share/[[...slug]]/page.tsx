import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(withPublicPrefix(props,["saved-share"]));
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(withPublicPrefix(props,["saved-share"]),segments=>null);
}
