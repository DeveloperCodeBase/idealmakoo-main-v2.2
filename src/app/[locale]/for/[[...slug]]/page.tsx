import {AudiencePage} from '@/components/site/Home';
import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(withPublicPrefix(props,["for"]));
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(withPublicPrefix(props,["for"]),segments=><AudiencePage audience={segments[1]}/>);
}
