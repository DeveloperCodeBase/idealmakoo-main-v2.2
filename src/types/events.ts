import type {Localized} from '@/data/catalog';
export interface EventSessionBase {id:string;recordId:string|null;kind:'event'|'factory_visit';startsAt:string;endsAt:string;timezone:string;location:string;capacity:number;remaining:number;confirmedSeats:number;waitingSeats:number;waitlistEnabled:boolean;state:'open'|'closed'|'cancelled';version:number}
export interface PublicEventSession extends EventSessionBase {title:string}
export interface ManagedEventSession extends EventSessionBase {title:Localized}
export interface EventSessionInput {recordId?:string;kind:'event'|'factory_visit';title:Localized;startsAt:string;endsAt:string;timezone:string;location:string;capacity:number;waitlistEnabled:boolean;state:'open'|'closed'|'cancelled'}
