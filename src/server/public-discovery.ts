import {z} from 'zod';
import {parse} from './http';
import {getPublicSite} from './workspace';
import {publicResourceDiscovery} from './resources';
import {buildDiscoveryIndex,searchDiscoveryIndex,discoveryKinds} from './discovery-index';

const searchSchema=z.object({locale:z.enum(['fa','en','tr','ar','ru']).default('fa'),q:z.string().trim().max(160).default(''),kind:z.union([z.enum(discoveryKinds),z.literal('')]).optional(),category:z.string().trim().max(120).optional(),limit:z.coerce.number().int().min(1).max(30).default(20),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
/** No actor or private workspace input is accepted. Permissions, publication
 * status and resource rights are evaluated afresh for every search request. */
export async function searchPublicContent(input:unknown){
 const options=parse(searchSchema,input);
 const [site,resources]=await Promise.all([getPublicSite(),publicResourceDiscovery()]);
 return{...searchDiscoveryIndex(buildDiscoveryIndex(site,options.locale,resources),options),locale:options.locale,query:options.q};
}
