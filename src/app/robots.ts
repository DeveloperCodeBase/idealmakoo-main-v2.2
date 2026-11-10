import type{MetadataRoute}from 'next';
import {publicOrigin} from '@/server/public-site';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{return {rules:[{userAgent:'*',allow:'/',disallow:['/api/','/admin/','/*/admin/','/*/account/','/*/auth/','/*/page/','/*/published/','/*/feedback/','/*/saved-share/','/*/communication-preferences/','/*/communication-verification/','/*/communication-unsubscribe/']}],sitemap:publicOrigin()+'/sitemap.xml'};}
