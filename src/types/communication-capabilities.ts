import type {Locale} from '@/lib/i18n';
export type CommunicationChannel='sms'|'telegram'|'push';
export type PreferenceTopic='requests'|'products'|'research'|'events';
export interface TopicPreference {enabled:boolean;frequency:'instant'|'daily'|'weekly';quietStart:string|null;quietEnd:string|null}
export interface RecipientPreferences {schemaVersion:1;timezone:string;topics:Partial<Record<PreferenceTopic,TopicPreference>>}
export interface RecipientPreferenceView {locale:Locale;channel:'email'|CommunicationChannel;maskedDestination:string;version:number;preferences:RecipientPreferences;expiresAt:string;csrfToken:string;scope:'preferences'|'unsubscribe';messages?:{title:string;body:string;href:string}[]}
export interface VerificationView {locale:Locale;channel:CommunicationChannel;maskedDestination:string;expiresAt:string;csrfToken:string;status:'verified'|'pending'}
export interface SurveyView {kind:'csat'|'nps';locale:Locale;question:string;minimum:number;maximum:number;expiresAt:string;submitted:boolean;csrfToken:string}
export interface ChannelCapabilities {sms:{configured:boolean;verification:boolean};telegram:{configured:boolean;verification:boolean};push:{configured:boolean;verification:boolean};pushSdkUrl:string|null}
export interface RecipientChannel {id:string;channel:CommunicationChannel;provider:string;maskedDestination:string;verified:boolean;active:boolean;available:boolean;version:number;endpointVersion:number;verifiedAt:string|null;createdAt:string;preferences:RecipientPreferences}
export interface RecipientChannelDirectory {items:RecipientChannel[];capabilities:ChannelCapabilities;locale:Locale;phoneAvailable:boolean;phoneEndpoints?:{id:string;maskedDestination:string}[]}
export interface ChannelConnection {binding:RecipientChannel;status:'pending';expiresAt:string;verificationUrl?:string;telegramUrl?:string}
