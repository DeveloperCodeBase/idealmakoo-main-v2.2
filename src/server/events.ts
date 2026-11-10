/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
type Locale='fa'|'en'|'tr'|'ar'|'ru';

interface SessionRow {id:string;record_id:string|null;kind:'event'|'factory_visit';title:Record<Locale,string>;starts_at:Date;ends_at:Date;timezone:string;location:string;capacity:number;waitlist_enabled:boolean;state:'open'|'closed'|'cancelled';version:number;created_at:Date}

interface RegistrationRow {id:string;session_id:string;request_id:string;user_id:string;seats:number;locale:Locale;status:EventBooking['status'];version:number;created_at:Date}

import type { PoolClient } from 'pg';
import type { FrontRequest, EventBooking } from '../types/frontend';
import type { Actor } from './types';
import { z } from "zod";
import { assert } from "./types";
import { canWorkspace } from "../lib/auth";
import { enqueueAccountNotification } from "./notification-policy";
import { transaction, audit } from "./db";
import { lockWorkspace } from "./workspace";
import { loadCrmAccess } from "./workspace-scopes";
import { parse, rateLimit } from "./http";
import { randomUUID } from "node:crypto";
import { hash } from "./crypto";
const locales = ["fa", "en", "tr", "ar", "ru"] as const;
const localized=z.object({fa:z.string().trim().min(1).max(240),en:z.string().trim().min(1).max(240),tr:z.string().trim().min(1).max(240),ar:z.string().trim().min(1).max(240),ru:z.string().trim().min(1).max(240)}).strict();
const fields={recordId:z.string().min(1).max(160).optional(),kind:z.enum(['event','factory_visit']),title:localized,startsAt:z.string().datetime({offset:true}),endsAt:z.string().datetime({offset:true}),timezone:z.string().max(100).default('Asia/Tehran'),location:z.string().max(2000).default(''),capacity:z.number().int().min(1).max(100000),waitlistEnabled:z.boolean().default(true),state:z.enum(['open','closed','cancelled']).default('open')};
const updateFields = z.object({ title: localized.optional(), startsAt: z.string().datetime({offset:true}).optional(), endsAt: z.string().datetime({offset:true}).optional(), timezone: z.string().max(100).optional(), location: z.string().max(2000).optional(), capacity: z.number().int().min(1).max(100000).optional(), waitlistEnabled: z.boolean().optional(), state: z.enum(['open','closed','cancelled']).optional() }).strict();
function requireManager(actor:Actor,kind:'event'|'factory_visit') {assert(actor.mfaVerified&&(kind==='factory_visit'?['admin','superAdmin','business'].includes(actor.role):canWorkspace(actor.role,'edit','events')),403,'FORBIDDEN','You cannot manage this booking calendar.');}
function requireLocale(actor: Actor, locale: Locale) { (assert)(actor.allowedLocales.includes(locale), 403, "CONTENT_LOCALE", "This booking language is outside your current permissions."); }
function localizedChanges(actor: Actor, before: Record<Locale,string> | undefined, after: Record<Locale,string> | undefined) {
    if (after) {
        for (const locale of locales)
            if (after[locale] !== before?.[locale])
                requireLocale(actor, locale);
    }
}
function sharedChanges(actor: Actor, row: SessionRow, patch: z.infer<typeof updateFields>) {
    const changed = patch.startsAt !== void 0 && Date.parse(patch.startsAt) !== row.starts_at.getTime() || patch.endsAt !== void 0 && Date.parse(patch.endsAt) !== row.ends_at.getTime() || patch.timezone !== void 0 && patch.timezone !== row.timezone || patch.location !== void 0 && patch.location !== row.location || patch.capacity !== void 0 && patch.capacity !== row.capacity || patch.waitlistEnabled !== void 0 && patch.waitlistEnabled !== row.waitlist_enabled || patch.state !== void 0 && patch.state !== row.state;
    if (changed) {
        for (const locale of locales)
            if (row.title[locale] || patch.title?.[locale])
                requireLocale(actor, locale);
    }
}
function identifier(value:string){assert(z.string().uuid().safeParse(value).success,404,'NOT_FOUND','Booking calendar not found.');}
function validDates(start:string|Date,end:string|Date,timezone:string){assert(Date.parse(String(end))>Date.parse(String(start)),422,'EVENT_DATES','The end must be after the start.');try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{assert(false,422,'TIMEZONE','Use a valid IANA timezone.');}}
async function sourceVisible(client:PoolClient,row:SessionRow,locale:Locale){if(row.kind==='factory_visit')return true;return !!(await client.query("SELECT 1 FROM locale_releases r JOIN workspace_entities e ON e.bucket=r.document_bucket AND e.id=r.document_id WHERE r.document_bucket='records' AND r.document_id=$1 AND r.locale=$2 AND r.kind IN ('events','event') AND r.unpublished_at IS NULL AND e.deleted_at IS NULL AND e.status<>'archived'",[row.record_id,locale])).rowCount;}
async function counts(client:PoolClient,id:string){const row=(await client.query("SELECT coalesce(sum(seats) FILTER(WHERE status IN ('confirmed','attended','no_show')),0)::int AS occupied,coalesce(sum(seats) FILTER(WHERE status='waitlisted'),0)::int AS waiting FROM event_registrations WHERE session_id=$1",[id])).rows[0];return row as {occupied:number;waiting:number};}
function sessionDto(row:SessionRow,count:{occupied:number;waiting:number},locale?:Locale){return{id:row.id,recordId:row.record_id,kind:row.kind,title:locale?row.title[locale]:row.title,startsAt:row.starts_at.toISOString(),endsAt:row.ends_at.toISOString(),timezone:row.timezone,location:row.location,capacity:row.capacity,remaining:Math.max(0,row.capacity-count.occupied),confirmedSeats:count.occupied,waitingSeats:count.waiting,waitlistEnabled:row.waitlist_enabled,state:row.state,version:row.version};}
async function notifyBooking(client:PoolClient,registration:RegistrationRow,session:SessionRow,status:EventBooking['status'],suffix:string){const body=`${session.title[registration.locale]} — ${status} — ${session.starts_at.toISOString()}`;await enqueueAccountNotification(client,{userId:registration.user_id,topic:'requests',channel:'in-app',purpose:'transactional',title:'رزرو / Booking',body,href:`/${registration.locale}/account/requests/?id=${registration.request_id}`,requestId:registration.request_id},`booking:${registration.id}:${suffix}`);}
async function listEventSessions(actor:Actor|null,options:{recordId?:string;kind?:string;locale?:string;manage?:boolean}){
    const locale=(['fa','en','tr','ar','ru'].includes(options.locale||'')?options.locale:'fa') as Locale;
    return (transaction)(async (client) => {
        if (options.manage) {
            assert(actor,401,'SESSION_REQUIRED','Sign in to continue.');
            await (lockWorkspace)(client);
            actor = await (loadCrmAccess)(actor, client);
            assert(actor.mfaVerified&&(canWorkspace(actor.role,'view','events')||['superAdmin','admin','business'].includes(actor.role)),403,'FORBIDDEN','You cannot read booking administration.');
        }
        const args:unknown[]=[];
        const filters:string[]=[];
        if (options.recordId) {
            args.push(options.recordId);
            filters.push(`record_id=$${args.length}`);
        }
        if (options.kind) {
            assert(['event','factory_visit'].includes(options.kind),422,'KIND','Use event or factory_visit.');
            args.push(options.kind);
            filters.push(`kind=$${args.length}`);
        }
        if (!options.manage)
            filters.push("state='open' AND starts_at>now()");
        const rows=(await client.query<SessionRow>('SELECT * FROM event_sessions'+(filters.length?' WHERE '+filters.join(' AND '):'')+' ORDER BY starts_at,id LIMIT 500',args)).rows;
        const items=[];
        for (const row of rows) {
            if (options.manage) {
                if (row.kind === "factory_visit" && !['superAdmin','admin','business'].includes(actor!.role))
                    continue;
                if (row.kind === "event" && !canWorkspace(actor!.role,'view','events'))
                    continue;
            }
            else if (!await sourceVisible(client,row,locale))
                continue;
            items.push(sessionDto(row,await counts(client,row.id),options.manage?undefined:locale));
        }
        return { items };
    });
}
async function createEventSession(actor:Actor,body:unknown){
    const input=parse(z.object(fields).strict(),body);
    requireManager(actor,input.kind);
    validDates(input.startsAt,input.endsAt,input.timezone);
    assert(input.kind!=='event'||input.recordId,422,'EVENT_RECORD','Select an event content record.');
    assert(Date.parse(input.startsAt)>Date.now(),422,'EVENT_DATES','Create a future booking session.');
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        actor = await (loadCrmAccess)(actor, client);
        requireManager(actor,input.kind);
        localizedChanges(actor, void 0, input.title);
        if (input.recordId)
            assert((await client.query("SELECT 1 FROM workspace_entities WHERE bucket='records' AND id=$1 AND collection='events' AND deleted_at IS NULL AND status<>'archived'",[input.recordId])).rowCount,422,'EVENT_RECORD','Select an active event content record.');
        const id=randomUUID();
        const row=(await client.query<SessionRow>('INSERT INTO event_sessions(id,record_id,kind,title,starts_at,ends_at,timezone,location,capacity,waitlist_enabled,state,created_by,updated_by) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *',[id,input.recordId||null,input.kind,JSON.stringify(input.title),input.startsAt,input.endsAt,input.timezone,input.location,input.capacity,input.waitlistEnabled,input.state,actor.id])).rows[0];
        await audit(actor.id,'event.session.created','event_session',id,{kind:input.kind},client);
        return sessionDto(row,{occupied:0,waiting:0});
    });
}
async function updateEventSession(actor:Actor,id:string,body:unknown,expected:number){
    identifier(id);
    const patch = (parse)(updateFields, body);
    return (transaction)(async (client) => {
        await lockWorkspace(client);
        actor = await (loadCrmAccess)(actor, client);
        const row=(await client.query<SessionRow>('SELECT * FROM event_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
        assert(row,404,'NOT_FOUND','Booking calendar not found.');
        requireManager(actor,row.kind);
        localizedChanges(actor, row.title, patch.title);
        sharedChanges(actor, row, patch);
        assert(row.version===expected,409,'CONFLICT','This calendar changed. Refresh and retry.');
        assert(row.state!=='cancelled',409,'EVENT_CANCELLED','A cancelled session cannot be reopened; create a new session.');
        const count=await counts(client,id);
        const capacity=patch.capacity??row.capacity;
        assert(capacity>=count.occupied,409,'CAPACITY_RESERVED','Cancel or move existing reservations before reducing capacity below the reserved seats.');
        validDates(patch.startsAt||row.starts_at,patch.endsAt||row.ends_at,patch.timezone||row.timezone);
        const next=(await client.query<SessionRow>('UPDATE event_sessions SET title=$2::jsonb,starts_at=$3,ends_at=$4,timezone=$5,location=$6,capacity=$7,waitlist_enabled=$8,state=$9,version=version+1,updated_by=$10,updated_at=now() WHERE id=$1 RETURNING *',[id,JSON.stringify(patch.title||row.title),patch.startsAt||row.starts_at,patch.endsAt||row.ends_at,patch.timezone||row.timezone,patch.location??row.location,capacity,patch.waitlistEnabled??row.waitlist_enabled,patch.state||row.state,actor.id])).rows[0];
        if (next.state === "cancelled") {
            const registrations=(await client.query<RegistrationRow>("UPDATE event_registrations SET status='cancelled',cancelled_at=now(),updated_at=now(),version=version+1 WHERE session_id=$1 AND status IN ('confirmed','waitlisted') RETURNING *",[id])).rows;
            for (const registration of registrations)
                await notifyBooking(client,registration,next,'cancelled','session-cancelled');
        }
        else {
            await promoteWaiting(client,next);
            if (patch.startsAt || patch.endsAt || patch.location) {
                for (const registration of (await client.query<RegistrationRow>("SELECT * FROM event_registrations WHERE session_id=$1 AND status IN ('confirmed','waitlisted')",[id])).rows)
                    await notifyBooking(client,registration,next,registration.status,'session-update:'+next.version);
            }
        }
        await audit(actor.id,'event.session.updated','event_session',id,{fields:Object.keys(patch),version:next.version},client);
        return sessionDto(next,await counts(client,id));
    });
}
async function reserveRequestBooking(client:PoolClient,actor:Actor|null,request:FrontRequest,sessionId:string,seats=1):Promise<EventBooking>{identifier(sessionId);assert(actor,401,'SESSION_REQUIRED','Sign in to reserve a place.');const user=(await client.query('SELECT email,email_verified,active FROM users WHERE id=$1 FOR SHARE',[actor.id])).rows[0];assert(user?.active&&user.email_verified,409,'EMAIL_VERIFICATION_REQUIRED','Verify your account email before reserving a place.');assert(request.email.toLowerCase()===user.email,422,'BOOKING_EMAIL','Use the verified email of your signed-in account.');
  const session=(await client.query<SessionRow>('SELECT * FROM event_sessions WHERE id=$1 FOR UPDATE',[sessionId])).rows[0];assert(session&&session.state==='open'&&session.starts_at.getTime()>Date.now(),409,'EVENT_CLOSED','This booking session is closed.');assert((request.kind==='event_registration'&&session.kind==='event')||(request.kind==='factory_visit'&&session.kind==='factory_visit'),422,'EVENT_KIND','The selected session does not match this request.');const locale=(request.locale||'fa') as Locale;assert(await sourceVisible(client,session,locale),409,'EVENT_UNPUBLISHED','This event is not published in the selected language.');assert(Number.isInteger(seats)&&seats>0&&seats<=20&&seats<=session.capacity,422,'SEATS','Select a valid number of seats.');const subject=hash('event-user:'+actor.id);
  assert(!(await client.query("SELECT 1 FROM event_registrations WHERE session_id=$1 AND subject_hash=$2 AND status IN ('confirmed','waitlisted')",[sessionId,subject])).rowCount,409,'ALREADY_REGISTERED','This account already has an active registration for this session.');const count=await counts(client,sessionId);const confirmed=count.occupied+seats<=session.capacity;assert(confirmed||session.waitlist_enabled,409,'EVENT_FULL','This session has no remaining places.');const registration=(await client.query<RegistrationRow>('INSERT INTO event_registrations(id,session_id,request_id,user_id,subject_hash,seats,locale,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[randomUUID(),sessionId,request.id,actor.id,subject,seats,locale,confirmed?'confirmed':'waitlisted'])).rows[0];await notifyBooking(client,registration,session,registration.status,'created');await audit(actor.id,'event.registration.created','event_registration',registration.id,{sessionId,seats,status:registration.status,requestId:request.id},client);return bookingDto(registration,session);
}
function bookingDto(row:RegistrationRow,session:SessionRow):EventBooking{return{id:row.id,sessionId:row.session_id,requestId:row.request_id,status:row.status,seats:row.seats,version:row.version,kind:session.kind,title:session.title[row.locale],startsAt:session.starts_at.toISOString(),endsAt:session.ends_at.toISOString(),timezone:session.timezone,location:session.location};}
async function getRequestBooking(requestId:string,client?:PoolClient):Promise<EventBooking|undefined>{const load=async(c:PoolClient)=>{const row=(await c.query<RegistrationRow>('SELECT * FROM event_registrations WHERE request_id=$1',[requestId])).rows[0];if(!row)return undefined;const session=(await c.query<SessionRow>('SELECT * FROM event_sessions WHERE id=$1',[row.session_id])).rows[0];return bookingDto(row,session);};return client?load(client):transaction(load);}
async function promoteWaiting(client:PoolClient,session:SessionRow){if(session.state!=='open'||session.starts_at.getTime()<=Date.now())return;let remaining=session.capacity-(await counts(client,session.id)).occupied;for(const row of (await client.query<RegistrationRow>("SELECT * FROM event_registrations WHERE session_id=$1 AND status='waitlisted' ORDER BY created_at,id FOR UPDATE",[session.id])).rows){if(row.seats>remaining)break;const user=(await client.query('SELECT active,email_verified FROM users WHERE id=$1',[row.user_id])).rows[0];if(!user?.active||!user.email_verified){await client.query("UPDATE event_registrations SET status='cancelled',cancelled_at=now(),updated_at=now(),version=version+1 WHERE id=$1",[row.id]);await notifyBooking(client,row,session,'cancelled','account-unavailable');continue;}await client.query("UPDATE event_registrations SET status='confirmed',updated_at=now(),version=version+1 WHERE id=$1",[row.id]);remaining-=row.seats;await notifyBooking(client,row,session,'confirmed','promoted');await audit(null,'event.registration.promoted','event_registration',row.id,{sessionId:session.id},client);}}
async function cancelRequestBooking(client:PoolClient,requestId:string,actorId:string|null){const found=(await client.query<RegistrationRow>('SELECT * FROM event_registrations WHERE request_id=$1',[requestId])).rows[0];if(!found)return;const session=(await client.query<SessionRow>('SELECT * FROM event_sessions WHERE id=$1 FOR UPDATE',[found.session_id])).rows[0];const row=(await client.query<RegistrationRow>("UPDATE event_registrations SET status='cancelled',cancelled_at=now(),updated_at=now(),version=version+1 WHERE id=$1 AND status IN ('confirmed','waitlisted') RETURNING *",[found.id])).rows[0];if(!row)return;await notifyBooking(client,row,session,'cancelled','withdrawn');await promoteWaiting(client,session);await audit(actorId,'event.registration.cancelled','event_registration',row.id,{requestId},client);}
async function listOwnBookings(actor:Actor){return transaction(async client=>{const rows=(await client.query<RegistrationRow>('SELECT * FROM event_registrations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500',[actor.id])).rows;const items=[];for(const row of rows){const session=(await client.query<SessionRow>('SELECT * FROM event_sessions WHERE id=$1',[row.session_id])).rows[0];items.push(bookingDto(row,session));}return{items};});}
async function listEventAttendees(actor:Actor,id:string){ identifier(id); await rateLimit('event-attendees:'+actor.id,60,60); return (transaction)(async (client) => { await (lockWorkspace)(client); actor = await (loadCrmAccess)(actor, client); const session=(await client.query<SessionRow>('SELECT * FROM event_sessions WHERE id=$1',[id])).rows[0]; assert(session,404,'NOT_FOUND','Booking calendar not found.'); requireManager(actor,session.kind); const rows = (await client.query("SELECT r.*,u.name,u.email FROM event_registrations r JOIN users u ON u.id=r.user_id WHERE r.session_id=$1 AND r.locale=ANY($2::text[]) ORDER BY r.created_at,r.id LIMIT 2000", [id, actor.allowedLocales])).rows; const showContact=['superAdmin','admin'].includes(actor.role); return { items: rows.map(row=>({...bookingDto(row,session),...(showContact?{name:row.name,email:row.email}:{name:'Participant'})})) }; }); }
async function eventCalendar(id:string,locale:Locale){identifier(id);return transaction(async client=>{const row=(await client.query<SessionRow>('SELECT * FROM event_sessions WHERE id=$1',[id])).rows[0];assert(row&&row.state!=='cancelled'&&await sourceVisible(client,row,locale),404,'NOT_FOUND','Event not found.');const stamp=(date:Date)=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');const escape=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Ideal Makoo//Events//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT',`UID:${row.id}@idealmakoo`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(row.starts_at)}`,`DTEND:${stamp(row.ends_at)}`,`SUMMARY:${escape(row.title[locale])}`,`LOCATION:${escape(row.location)}`,'END:VEVENT','END:VCALENDAR'];const fold=(line:string)=>{const out:string[]=[];let part='';for(const char of line){if(Buffer.byteLength(part+char)>73){out.push(part);part=' '+char;}else part+=char;}out.push(part);return out.join('\r\n');};return new Response(lines.map(fold).join('\r\n')+'\r\n',{headers:{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':`attachment; filename="event-${row.id}.ics"`,'Cache-Control':'public, max-age=60','X-Content-Type-Options':'nosniff'}});});}
export { cancelRequestBooking, createEventSession, eventCalendar, getRequestBooking, listEventAttendees, listEventSessions, listOwnBookings, reserveRequestBooking, updateEventSession };
