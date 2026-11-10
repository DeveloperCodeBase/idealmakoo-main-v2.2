import Home from '@/components/site/Home';
import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(props);
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(props,segments=><Home/>);
}
