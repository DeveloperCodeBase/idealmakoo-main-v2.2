import LocaleRedirect from '@/components/LocaleRedirect';
import{adminSections}from '@/lib/routes';
export const dynamicParams=false;
export function generateStaticParams(){return adminSections.map(s=>({slug:s?s.split('/'):[]}));}
export default async function Page({params}:{params:Promise<{slug?:string[]}>}){const{slug=[]}=await params;return <LocaleRedirect path={'admin/'+slug.join('/')}/>;}
