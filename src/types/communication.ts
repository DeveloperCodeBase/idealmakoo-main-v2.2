import type {Locale} from '@/lib/i18n';
export type VerifiedChannel='sms'|'telegram'|'push';
export type CommunicationTopic='requests'|'products'|'research'|'events'|'content';
export interface CommunicationPolicy{enabled:boolean;frequency:'instant'|'daily'|'weekly';quietStart:string|null;quietEnd:string|null}
export interface BindingPreferences{schemaVersion:1;timezone:string;topics:Record<CommunicationTopic,CommunicationPolicy>}
export interface CommunicationBinding{id:string;channel:VerifiedChannel;provider:string;maskedDestination:string;verified:boolean;active:boolean;available:boolean;version:number;endpointVersion:number;verifiedAt:string|null;createdAt:string;preferences:BindingPreferences}
export interface CommunicationDirectory{items:CommunicationBinding[];capabilities:Record<VerifiedChannel,{configured:boolean;verification:boolean}>&{pushSdkUrl:string|null};locale:Locale;phoneAvailable:boolean;phoneEndpoints?:{id:string;maskedDestination:string}[]}
export interface CommunicationConnection{binding:CommunicationBinding;status:'pending';expiresAt:string;verificationUrl?:string;telegramUrl?:string}
