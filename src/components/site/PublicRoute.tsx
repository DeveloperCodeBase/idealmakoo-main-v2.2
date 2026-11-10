import 'server-only';

import Home,{AudiencePage} from '@/components/site/Home';
import {ProductCatalog,ProductDetail,Comparison} from '@/components/site/Products';
import {InquiryPage,CooperationPage,ContactPage,SingleRequestPage,TechnicalSelection,DistributorPage} from '@/components/site/Requests';
import {ShadeMatcher,ProtocolTimer,SerialCheck,FaqPage,PolicyPage} from '@/components/site/Tools';
import {ResourceCenter} from '@/components/content/ResourceCenter';
import {ResearchCenter} from '@/components/content/ResearchCenter';
import {CompanyContent} from '@/components/content/CompanyContent';
import {EditorialCenter} from '@/components/content/EditorialCenter';
import PublishedPage from '@/components/site/PublishedPage';
import GlossaryPage from '@/components/content/GlossaryPage';
import InstallGuide from '@/components/site/InstallGuide';
import CustomProductQuery from '@/components/site/CustomProductQuery';

/**
 * Select the public client entry point before streaming the page. Passing that
 * element through Application preserves provider access without a client lazy
 * boundary that could replace already-rendered content during hydration.
 * Authorization, publication visibility and capability handling stay in Page
 * and Application; this mapper only receives public route segments.
 */
export default function PublicRoute({segments}:{segments:string[]}){
  const [section,slug,third]=segments;
  const path=segments.join('/');
  if(['admin','account','auth'].includes(section))return null;
  if(!section)return <Home/>;
  if(section==='products')return slug==='category'?<ProductCatalog category={third}/>:slug==='detail'?<CustomProductQuery/>:slug?<ProductDetail slug={slug}/>:<ProductCatalog/>;
  if(section==='research')return <ResearchCenter slug={slug}/>;
  if(section==='resources')return <ResourceCenter slug={slug}/>;
  if(section==='compare')return <Comparison/>;
  if(section==='inquiry-list')return <InquiryPage/>;
  if(section==='technical-selection')return <TechnicalSelection/>;
  if(section==='cooperation')return <CooperationPage section={slug}/>;
  if(section==='contact'||section==='support')return <ContactPage support={section==='support'}/>;
  if(section==='sample-request')return <SingleRequestPage kind="sample_request"/>;
  if(section==='quality-report')return <SingleRequestPage kind="quality_complaint"/>;
  if(section==='factory-visit')return <SingleRequestPage kind="factory_visit"/>;
  if(path==='careers/apply')return <SingleRequestPage kind="job_application"/>;
  if(section==='distributors')return <DistributorPage/>;
  if(path==='tools/shade-mould-matcher')return <ShadeMatcher/>;
  if(path==='tools/clinical-protocol')return <ProtocolTimer/>;
  if(section==='for')return <AudiencePage audience={slug}/>;
  if(section==='glossary')return <GlossaryPage slug={slug}/>;
  if(section==='faq')return <FaqPage/>;
  if(section==='verify-product')return <SerialCheck/>;
  if(section==='install')return <InstallGuide/>;
  if(section==='privacy'||section==='terms')return <PolicyPage kind={section}/>;
  if(section==='page'||section==='published')return <PublishedPage/>;
  if(section==='knowledge')return <EditorialCenter section="knowledge" slug={slug}/>;
  if(['news','blog','events','careers','videos','media','press-kit'].includes(section))return <EditorialCenter section={section} slug={slug}/>;
  return <CompanyContent section={section}/>;
}
