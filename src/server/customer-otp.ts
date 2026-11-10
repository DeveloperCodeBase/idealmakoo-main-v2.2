import {createHmac,randomInt,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {config} from './config';
import {audit,query,transaction} from './db';
import {decrypt,encrypt,equal,hash,passwordHash,token} from './crypto';
import {json,parse,rateLimit,visitorKey} from './http';
import {assert,locales} from './types';
import {newSession,signedInResponse,type UserRow} from './auth';
import type {NotificationPayload} from './notification-policy';

const ttl=300, resend=60;
export function normalizeCustomerPhone(value:string):string {
  let phone=value.trim().replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[\s().-]/g,'');
  if(/^09\d{9}$/.test(phone))phone='+98'+phone.slice(1);
  else if(/^989\d{9}$/.test(phone))phone='+'+phone;
  else if(phone.startsWith('00'))phone='+'+phone.slice(2);
  assert(/^\+[1-9]\d{9,14}$/.test(phone),422,'PHONE_INVALID','Enter an international phone number or an Iranian mobile number.');
  return phone;
}
const secretHash=(purpose:string,value:string)=>createHmac('sha256',config().sessionSecret).update('customer-otp-v1:'+purpose+':'+value).digest('hex');
const codeHash=(challenge:string,code:string)=>secretHash('code',challenge+':'+code);
const phoneHash=(phone:string)=>secretHash('phone',phone);
export function customerOtpStatus(){
  const configured=process.env.NOTIFICATIONS_MODE==='live'&&!!process.env.KAVENEGAR_API_KEY&&/^[A-Za-z0-9_-]{1,100}$/.test(process.env.KAVENEGAR_OTP_TEMPLATE||'');
  return {enabled:process.env.CUSTOMER_SMS_OTP_ENABLED!=='false'&&configured,configured,provider:'kavenegar',expiresIn:ttl,retryAfter:resend};
}
export async function requestCustomerOtp(request:Request,body:unknown){
  const input=parse(z.object({phone:z.string().min(6).max(40),name:z.string().trim().min(2).max(100).optional(),locale:z.enum(locales).default('fa'),consent:z.literal(true)}).strict(),body);
  assert(customerOtpStatus().enabled,503,'SMS_NOT_CONFIGURED','SMS sign-in is not configured. Ask the site administrator to enable the approved OTP provider.');
  const phone=normalizeCustomerPhone(input.phone),identity=phoneHash(phone);
  await rateLimit('customer-otp:ip:'+visitorKey(request),10,3600);
  await rateLimit('customer-otp:phone:'+identity,5,3600);
  const raw=token(),digest=hash(raw),code=String(randomInt(0,1_000_000)).padStart(6,'0');
  await transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['customer-otp:'+identity]);
    const recent=(await client.query("SELECT 1 FROM customer_otp_challenges WHERE phone_hash=$1 AND created_at>clock_timestamp()-interval '60 seconds' LIMIT 1",[identity])).rowCount;
    assert(!recent,429,'OTP_COOLDOWN','Wait one minute before requesting another code.');
    await client.query('UPDATE customer_otp_challenges SET consumed_at=clock_timestamp() WHERE phone_hash=$1 AND consumed_at IS NULL',[identity]);
    await client.query("INSERT INTO customer_otp_challenges(token_hash,phone_hash,phone_encrypted,code_hash,display_name,locale,visitor_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes')",[digest,identity,encrypt(phone),codeHash(digest,code),input.name||'',input.locale,visitorKey(request)]);
    // Existing staff/disabled accounts receive the same public response, but the
    // public customer flow can never turn their phone into a login credential.
    const existing=(await client.query('SELECT role,active FROM users WHERE phone_number=$1',[phone])).rows[0];
    if(!existing||(existing.role==='customer'&&existing.active)){
      const payload={purpose:'customer-otp',customerOtp:digest,otp:true,code,to:phone,locale:input.locale,title:'Ideal Makoo',body:code};
      await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key) VALUES($1,'sms',$2::jsonb,$3)",[randomUUID(),JSON.stringify({encrypted:encrypt(JSON.stringify(payload))}),'customer-otp:'+digest]);
    }
    await audit(null,'auth.phone.code_requested','auth',digest,{locale:input.locale},client);
    await client.query("DELETE FROM customer_otp_challenges WHERE expires_at<now()-interval '24 hours'");
  });
  return {challengeToken:raw,expiresIn:ttl,retryAfter:resend,delivery:'queued'};
}
export async function verifyCustomerOtp(request:Request,body:unknown){
  const input=parse(z.object({challengeToken:z.string().min(20).max(100),code:z.string().regex(/^\d{6}$/),name:z.string().trim().min(2).max(100).optional()}).strict(),body);
  await rateLimit('customer-otp-verify:ip:'+visitorKey(request),30,900);
  const digest=hash(input.challengeToken);
  // Credential hashing happens outside the transaction; no password is exposed
  // or delivered. The random verifier prevents password login to a phone-only account.
  const encoded=await passwordHash(token()+token());
  const result=await transaction(async client=>{
    const candidate=(await client.query('SELECT phone_hash FROM customer_otp_challenges WHERE token_hash=$1',[digest])).rows[0];
    if(!candidate)return null;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['customer-otp:'+candidate.phone_hash]);
    const challenge=(await client.query('SELECT * FROM customer_otp_challenges WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE',[digest])).rows[0];
    if(!challenge||challenge.attempts>=5)return null;
    await client.query('UPDATE customer_otp_challenges SET attempts=attempts+1 WHERE token_hash=$1',[digest]);
    if(!equal(challenge.code_hash,codeHash(digest,input.code))){await audit(null,'auth.phone.denied','auth',digest,{},client);return null;}
    const phone=decrypt(challenge.phone_encrypted);
    let user=(await client.query<UserRow>('SELECT * FROM users WHERE phone_number=$1 FOR UPDATE',[phone])).rows[0];
    if(challenge.expires_at.getTime()<=Date.now()||user&&(!user.active||user.role!=='customer'||user.locked_until&&user.locked_until.getTime()>Date.now()))return null;
    const created=!user;
    if(!user){
      const id=randomUUID(),defaults={fa:'مشتری ایده‌آل ماکو',en:'Ideal Makoo customer',tr:'Ideal Makoo müşterisi',ar:'عميل إيدآل ماكو',ru:'Клиент Ideal Makoo'};
      user=(await client.query<UserRow>("INSERT INTO users(id,email,name,password_hash,role,phone_number,phone_verified_at,email_placeholder) VALUES($1,$2,$3,$4,'customer',$5,clock_timestamp(),true) RETURNING *",[id,'phone.'+id+'@identity.invalid',input.name||challenge.display_name||defaults[challenge.locale as keyof typeof defaults],encoded,phone])).rows[0];
      await client.query('INSERT INTO user_settings(user_id,profile,preferences) VALUES($1,$2::jsonb,$3::jsonb)',[id,JSON.stringify({phone}),JSON.stringify({language:challenge.locale})]);
      await client.query("INSERT INTO consent_events(user_id,purpose,accepted,policy_version,ip_hash) VALUES($1,'phone_account',true,'customer-otp-v1',$2)",[id,visitorKey(request)]);
      await audit(id,'auth.phone.register','user',id,{},client);
    }
    await client.query('UPDATE customer_otp_challenges SET consumed_at=clock_timestamp() WHERE token_hash=$1',[digest]);
    await audit(user.id,'auth.phone.login','user',user.id,{},client);
    if(user.mfa_enabled){
      const challengeToken=token();
      await client.query("INSERT INTO auth_challenges(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'mfa',clock_timestamp()+interval '5 minutes')",[hash(challengeToken),user.id]);
      return {mfa:true as const,challengeToken};
    }
    return {mfa:false as const,created,session:await newSession(user,request,false,client)};
  });
  assert(result,401,'OTP_INVALID','The code is invalid, expired, already used, or the account cannot sign in.');
  return result.mfa?json({mfaRequired:true,challengeToken:result.challengeToken}):signedInResponse(result.session,result.created?201:200);
}
export async function canDeliverCustomerOtp(client:PoolClient,payload:NotificationPayload,channel:string){
  if(channel!=='sms'||payload.purpose!=='customer-otp'||typeof payload.customerOtp!=='string'||typeof payload.code!=='string')return false;
  const row=(await client.query('SELECT * FROM customer_otp_challenges WHERE token_hash=$1 AND consumed_at IS NULL AND attempts<5 AND expires_at>clock_timestamp()',[payload.customerOtp])).rows[0];
  if(!row||decrypt(row.phone_encrypted)!==payload.to||!equal(row.code_hash,codeHash(row.token_hash,payload.code)))return false;
  const user=(await client.query('SELECT role,active FROM users WHERE phone_number=$1',[payload.to])).rows[0];
  return !user||user.role==='customer'&&user.active;
}
export async function hasVerifiedCustomerPhone(id:string){return !!(await query("SELECT 1 FROM users WHERE id=$1 AND active AND role='customer' AND phone_number IS NOT NULL AND phone_verified_at IS NOT NULL",[id])).rowCount;}
