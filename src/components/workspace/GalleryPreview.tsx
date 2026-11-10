'use client';
import {useEffect,useState} from 'react';
import {galleryPhotos} from '@/lib/gallery-photos';

/** Debounce only the rendered media snapshot; the editor's draft stays current.
 * The caller keys this component by page and block so replacements remount it. */
export function GalleryPreview({block}:{block:{body:string;title:string;mediaUrl?:string}}){
 const {body,title,mediaUrl}=block;
 const [photos,setPhotos]=useState(()=>galleryPhotos({body,title,mediaUrl}));
 useEffect(()=>{
  const timer=window.setTimeout(()=>setPhotos(galleryPhotos({body,title,mediaUrl})),300);
  return()=>window.clearTimeout(timer);
 },[body,title,mediaUrl]);
 return <div className="ws-preview-gallery">{photos.map((photo,index)=><figure className="ws-preview-image" key={index}><img src={photo.url} alt={photo.caption}/>{photo.caption&&<figcaption>{photo.caption}</figcaption>}</figure>)}</div>;
}
