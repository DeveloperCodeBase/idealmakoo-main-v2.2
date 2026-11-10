import {carouselUrl} from './carousel';

export interface GalleryPhoto {url:string;caption:string}

/** Keep authored gallery rows and the single-image fallback identical in the
 * public page and its editor preview. Captions remain text, never HTML. */
export function galleryPhotos(block:{body:string;title:string;mediaUrl?:string}):GalleryPhoto[]{
 const safeMedia=(value?:string)=>Boolean(value&&carouselUrl(value))||Boolean(value&&/^data:(image|video|audio)\//i.test(value));
 const photos=block.body.split('\n').map(row=>row.trim()).filter(Boolean).map(row=>{
  const[url,...caption]=row.split('|');return{url:url.trim(),caption:caption.join(' | ').trim()};
 }).filter(photo=>safeMedia(photo.url));
 if(!photos.length&&safeMedia(block.mediaUrl))photos.push({url:block.mediaUrl!,caption:block.title});
 return photos;
}
