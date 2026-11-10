import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {Actor} from './types';
import type {Locale} from '../lib/i18n';
import type {ProductRegistryEntry,ProductRegistryDirectory,ProductRegistryLookup} from '../lib/product-registry';
import {normalizeRegistryCode} from '../lib/product-registry';
import {products} from '../data/catalog';
import {parseCustomProduct} from '../lib/custom-products';
import {canWorkspace} from '../lib/auth';
import {query,transaction,audit} from './db';
import {assert} from './types';
import {parse,rateLimit,visitorKey} from './http';
import {loadCrmAccess} from './workspace-scopes';
import {lockWorkspace} from './workspace';

const code=z.string().max(100).transform(value=>normalizeRegistryCode(value)).refine((value):value is string=>value!==null,'Use a complete 4–80 character ASCII serial or batch identifier.');
const optionalCode=z.union([z.literal(''),code]).default('');
const fields=z.object({code,kind:z.enum(['serial','batch']),productId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/),batchCode:optionalCode,status:z.enum(['registered','recalled','withdrawn']).default('registered'),internalNote:z.string().trim().max(2000).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)).default('')}).strict();
const valueSchema=fields.superRefine((value,ctx)=>{if(value.kind==='batch'&&value.batchCode)ctx.addIssue({code:'custom',path:['batchCode'],message:'A batch identifier cannot also declare a different parent batch.'});});
const locale=z.enum(['fa','en','tr','ar','ru']);
type RegistryRow={id:string;code:string;kind:ProductRegistryEntry['kind'];product_id:string;batch_code:string;status:ProductRegistryEntry['status'];internal_note:string;version:number;created_at:Date;updated_at:Date;archived_at:Date|null};
const dto=(row:RegistryRow):ProductRegistryEntry=>({id:row.id,code:row.code,kind:row.kind,productId:row.product_id,batchCode:row.batch_code,status:row.status,internalNote:row.internal_note,version:Number(row.version),createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),archivedAt:row.archived_at?.toISOString()||null});
async function administrator(actor:Actor,client?:PoolClient){actor=await loadCrmAccess(actor,client);assert(actor.mfaVerified&&['admin','superAdmin'].includes(actor.role)&&canWorkspace(actor.role,'manage','settings'),403,'FORBIDDEN','Product registry changes require current administrative settings authority and MFA.');return actor;}
async function productDirectory(client?:PoolClient):Promise<ProductRegistryDirectory['products']>{
  const known=new Map(products.map(product=>[product.id,{id:product.id,names:{...product.name}}]));
  // Only explicitly published custom product snapshots can identify public
  // lookup results. Unpublished drafts and CRM records never cross this API.
  const sql="SELECT r.locale,r.publication FROM locale_releases r JOIN workspace_entities e ON e.bucket=r.document_bucket AND e.id=r.document_id WHERE r.kind='product' AND r.unpublished_at IS NULL AND e.deleted_at IS NULL AND e.status<>'archived'";
  const rows=(await (client?client.query<{locale:Locale;publication:Record<string,unknown>}>(sql):query<{locale:Locale;publication:Record<string,unknown>}>(sql))).rows;
  for(const row of rows){const custom=parseCustomProduct(row.publication.customProduct);if(!custom)continue;const previous=known.get(custom.id)||{id:custom.id,names:{fa:'',en:'',tr:'',ar:'',ru:''}};previous.names[row.locale]=typeof row.publication.title==='string'?row.publication.title:custom.name[row.locale];known.set(custom.id,previous);}
  return[...known.values()];
}
export async function listProductRegistry(actor:Actor,body:unknown={}):Promise<ProductRegistryDirectory>{
  const input=parse(z.object({includeArchived:z.enum(['true','false']).default('false'),cursor:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict(),body);
  return transaction(async client=>{await lockWorkspace(client);actor=await administrator(actor,client);
    const rows=(await client.query<RegistryRow>('SELECT * FROM product_registry WHERE ($1 OR archived_at IS NULL) AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3',[input.includeArchived==='true',input.cursor||null,input.limit+1])).rows;
    return{items:rows.slice(0,input.limit).map(dto),products:await productDirectory(client),canManage:true,nextCursor:rows.length>input.limit?rows[input.limit-1].id:null};
  });
}
export async function createProductRegistry(actor:Actor,body:unknown):Promise<ProductRegistryEntry>{
  await administrator(actor);const input=parse(valueSchema,body);
  return transaction(async client=>{await lockWorkspace(client);actor=await administrator(actor,client);
    assert((await productDirectory(client)).some(product=>product.id===input.productId),422,'REGISTRY_PRODUCT','Select a known catalog or explicitly published custom product.');
    assert(!(await client.query('SELECT 1 FROM product_registry WHERE code=$1',[input.code])).rowCount,409,'REGISTRY_CODE_EXISTS','This code already has a retained registry identity. Edit or restore that entry instead.');
    const row=(await client.query<RegistryRow>('INSERT INTO product_registry(id,code,kind,product_id,batch_code,status,internal_note,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *',[randomUUID(),input.code,input.kind,input.productId,input.batchCode,input.status,input.internalNote,actor.id])).rows[0];
    await audit(actor.id,'product_registry.created','product_registry',row.id,{code:row.code,kind:row.kind,productId:row.product_id,status:row.status,version:row.version},client);return dto(row);
  });
}
export async function updateProductRegistry(actor:Actor,id:string,body:unknown):Promise<ProductRegistryEntry>{
  const input=parse(z.object({expectedVersion:z.number().int().positive(),value:valueSchema}).strict(),body);parse(z.string().uuid(),id);await administrator(actor);
  return transaction(async client=>{await lockWorkspace(client);actor=await administrator(actor,client);
    const row=(await client.query<RegistryRow>('SELECT * FROM product_registry WHERE id=$1 FOR UPDATE',[id])).rows[0];assert(row,404,'NOT_FOUND','Registry entry not found.');assert(row.version===input.expectedVersion,409,'REGISTRY_CONFLICT','The registry entry changed. Reload and review its current version.');assert(!row.archived_at,409,'REGISTRY_ARCHIVED','Restore the archived entry before editing it.');
    assert(row.code===input.value.code&&row.kind===input.value.kind,422,'REGISTRY_IDENTITY','A registry code and identifier type are immutable. Create a new identifier and archive the incorrect one.');
    assert((await productDirectory(client)).some(product=>product.id===input.value.productId),422,'REGISTRY_PRODUCT','Select a known catalog or explicitly published custom product.');
    const saved=(await client.query<RegistryRow>('UPDATE product_registry SET product_id=$2,batch_code=$3,status=$4,internal_note=$5,version=version+1,updated_by=$6,updated_at=now() WHERE id=$1 RETURNING *',[id,input.value.productId,input.value.batchCode,input.value.status,input.value.internalNote,actor.id])).rows[0];
    await audit(actor.id,'product_registry.updated','product_registry',id,{code:row.code,previous:{productId:row.product_id,batchCode:row.batch_code,status:row.status,version:row.version},current:{productId:saved.product_id,batchCode:saved.batch_code,status:saved.status,version:saved.version},noteChanged:row.internal_note!==saved.internal_note},client);return dto(saved);
  });
}
export async function changeProductRegistryState(actor:Actor,id:string,body:unknown):Promise<ProductRegistryEntry>{
  const input=parse(z.object({expectedVersion:z.number().int().positive(),operation:z.enum(['archive','restore'])}).strict(),body);parse(z.string().uuid(),id);await administrator(actor);
  return transaction(async client=>{await lockWorkspace(client);actor=await administrator(actor,client);const row=(await client.query<RegistryRow>('SELECT * FROM product_registry WHERE id=$1 FOR UPDATE',[id])).rows[0];assert(row,404,'NOT_FOUND','Registry entry not found.');assert(row.version===input.expectedVersion,409,'REGISTRY_CONFLICT','The registry entry changed. Reload and review its current version.');
    assert(input.operation==='archive'?!row.archived_at:!!row.archived_at,409,'REGISTRY_STATE','The registry entry is already in that state.');
    const saved=(await client.query<RegistryRow>("UPDATE product_registry SET archived_at=CASE WHEN $2='archive' THEN now() ELSE NULL END,version=version+1,updated_by=$3,updated_at=now() WHERE id=$1 RETURNING *",[id,input.operation,actor.id])).rows[0];
    await audit(actor.id,'product_registry.'+input.operation,'product_registry',id,{code:row.code,version:saved.version,retained:true},client);return dto(saved);
  });
}
export async function lookupProductRegistry(request:Request,body:unknown):Promise<ProductRegistryLookup>{
  await rateLimit('public-product-registry:'+visitorKey(request),30,60);
  const input=parse(z.object({code,locale:locale.default('fa')}).strict(),body),normalized=input.code;
  assert(normalized,422,'REGISTRY_CODE','Enter a complete serial or batch identifier.');
  return transaction(async client=>{
    const row=(await client.query<Pick<RegistryRow,'code'|'kind'|'product_id'|'batch_code'|'status'>>('SELECT code,kind,product_id,batch_code,status FROM product_registry WHERE code=$1 AND archived_at IS NULL',[normalized])).rows[0];
    const product=row?(await productDirectory(client)).find(product=>product.id===row.product_id):null;
    if(!row)return{matched:false,code:normalized,locale:input.locale,state:'not_registered'};
    // A product leaving the public catalogue must not hide a retained recall.
    // Only an available published label is used; never read its private draft.
    return{matched:true,code:row.code,locale:input.locale,state:'registered',kind:row.kind,status:row.status,product:{id:row.product_id,name:product?.names[input.locale]||''},batchCode:row.batch_code};
  });
}
