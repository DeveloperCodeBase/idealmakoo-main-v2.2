import type {Locale} from '../lib/i18n';

export interface ContentTranslationField {key:string;label:string;value:string;maxLength:number}
export interface ContentTranslationProposal {
 id:string;token:string;bucket:'records'|'pages';documentId:string;sourceLocale:Locale;locale:Locale;
 fields:ContentTranslationField[];provider:string;model:string;createdAt:string;expiresAt:string;
 sourceRevisionId:string;targetRevisionId:string;status:'proposed';
}
