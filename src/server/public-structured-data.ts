import type {LocalPublication} from '../data/workspace-seed';
import {editorialSeoIssues,editorialExpiry,parseEditorialSeo,safeEditorialUrl} from '../lib/editorial-seo';

/** Select an actual reviewed image, never the first arbitrary media attachment.
 * Download/audio/video URLs cannot be used as Open Graph or Product images. */
export function publicationSocialImage(publication:LocalPublication|undefined):string|undefined{
  if(!publication)return undefined;
  const image=(value:string|undefined):value is string=>{
    if(!value||!safeEditorialUrl(value,true))return false;
    const pathname=new URL(value,'https://editorial.invalid').pathname;
    const extension=pathname.match(/\.([a-z\d]+)$/i)?.[1]?.toLowerCase();
    return !extension||['jpg','jpeg','png','webp','avif','gif'].includes(extension);
  };
  if(image(publication.customProduct?.image))return publication.customProduct.image;
  for(const block of publication.blocks){
    if(block.hidden)continue;
    if(block.type==='gallery'){
      const photos=block.body.split('\n').map(row=>row.split('|',1)[0].trim());
      const first=photos.find(image);if(first)return first;
    }
    if(['image','hero','split','gallery'].includes(block.type)&&image(block.mediaUrl))return block.mediaUrl;
  }
  const thumbnail=parseEditorialSeo(publication.seo)?.video?.thumbnailUrl;
  return publication.blocks.some(block=>!block.hidden&&block.type==='video'&&block.mediaUrl&&safeEditorialUrl(block.mediaUrl,true))&&image(thumbnail)?thumbnail:undefined;
}

/** Optional schema fields are derived only from the reviewed locale revision. */
export function editorialStructuredData(publication:LocalPublication,origin:string,path:string,now=Date.now()):Record<string,unknown>|null{
  const seo=parseEditorialSeo(publication.seo);if(!seo)return null;
  const media=publication.blocks.find(block=>!block.hidden&&block.type==='video'&&block.mediaUrl);
  const context={collection:publication.kind,mediaType:media?'video':undefined,mediaUrl:media?.mediaUrl,location:publication.location,eventStart:publication.eventStart,eventEnd:publication.eventEnd};
  if(editorialSeoIssues(seo,context,now).length)return null;
  const url=`${origin}/${publication.locale}/${path}${path?'/':''}`,base={'@context':'https://schema.org',name:publication.title,description:publication.summary,url,inLanguage:publication.locale};
  const absolute=(value:string)=>new URL(value,origin).href;
  if(seo.job){
    if(seo.job.status!=='open'||editorialExpiry(seo.job.validThrough)<now)return null;
    return{...base,'@type':'JobPosting',title:publication.title,datePosted:seo.job.datePosted,validThrough:seo.job.validThrough,hiringOrganization:{'@type':'Organization',name:seo.job.hiringOrganization.name,...seo.job.hiringOrganization.url?{sameAs:absolute(seo.job.hiringOrganization.url)}:{}},jobLocation:{'@type':'Place',address:{'@type':'PostalAddress',...seo.job.location}},...seo.job.employmentType?{employmentType:seo.job.employmentType}:{}};
  }
  if(seo.event)return{...base,'@type':'Event',startDate:publication.eventStart,...publication.eventEnd?{endDate:publication.eventEnd}:{},eventStatus:({scheduled:'https://schema.org/EventScheduled',cancelled:'https://schema.org/EventCancelled',postponed:'https://schema.org/EventPostponed'} as const)[seo.event.status],location:{'@type':'Place',name:publication.location,address:{'@type':'PostalAddress',...seo.event.address}}};
  if(seo.video&&media?.mediaUrl&&safeEditorialUrl(media.mediaUrl,true))return{...base,'@type':'VideoObject',thumbnailUrl:absolute(seo.video.thumbnailUrl),uploadDate:seo.video.uploadDate,contentUrl:absolute(media.mediaUrl),...seo.video.durationSeconds?{duration:'PT'+seo.video.durationSeconds+'S'}:{}};
  if(seo.article){const image=publicationSocialImage(publication);return{...base,'@type':'Article',headline:publication.title,...image?{image:absolute(image)}:{},...seo.article.datePublished?{datePublished:seo.article.datePublished}:{},...seo.article.dateModified?{dateModified:seo.article.dateModified}:{},...seo.article.authors?.length?{author:seo.article.authors.map(author=>({'@type':author.type,name:author.name,...author.url?{url:absolute(author.url)}:{}}))}:{}};}
  return null;
}
