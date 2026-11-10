import PublicRoute from '@/components/site/PublicRoute';
import {generatePublicMetadata,renderPublicPage,type PublicPageProps} from '@/server/public-page';

export const dynamic='force-dynamic';
export const dynamicParams=true;
export const generateMetadata=generatePublicMetadata;

/** Published custom paths keep the same renderer and server access checks. */
export default function Page(props:PublicPageProps){
  return renderPublicPage(props,segments=><PublicRoute segments={segments}/>);
}
