import {generatePublicMetadata,renderPublicPage,withPublicPrefix,type PublicPageProps} from '@/server/public-page';
import AccountPortal from '@/components/account/AccountPortal';
import AccountRequestsEntry from '@/components/account/AccountRequestsEntry';

export const dynamic='force-dynamic';
export const dynamicParams=true;

export function generateMetadata(props:PublicPageProps){
  return generatePublicMetadata(withPublicPrefix(props,['account','requests']));
}

export default function Page(props:PublicPageProps){
  return renderPublicPage(withPublicPrefix(props,['account','requests']),segments=>{
    const section=segments.slice(1).join('/');
    return <AccountPortal section={section} body={<AccountRequestsEntry section={section}/>}/>;
  });
}
