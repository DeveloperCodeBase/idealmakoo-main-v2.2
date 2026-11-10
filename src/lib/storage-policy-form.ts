import type {UploadPolicyLimits} from './upload-policy';
export const storagePolicyFields=['maxFileBytes','image','document','video','audio','totalBytes','userBytes','guestBytes'] as const;
export type StoragePolicyField=typeof storagePolicyFields[number];
export type StoragePolicyForm=Record<StoragePolicyField,string>;
export function storagePolicyForm(limits:UploadPolicyLimits):StoragePolicyForm {
 return Object.fromEntries(storagePolicyFields.map(field=>[field,String((field in limits.byType?limits.byType[field as keyof typeof limits.byType]:limits[field as Exclude<StoragePolicyField,keyof typeof limits.byType>])/1024**2)])) as StoragePolicyForm;
}
/** Binary MiB input converts exactly to integer bytes before transport. */
export function parseStoragePolicyForm(input:StoragePolicyForm,hardMaxFileBytes:number):UploadPolicyLimits|null {
 const values={} as Record<StoragePolicyField,number>;
 for(const field of storagePolicyFields){const raw=input[field].trim();if(!/^(?:\d+\.?\d*|\.\d+)$/.test(raw))return null;const bytes=Number(raw)*1024**2;if(!Number.isSafeInteger(bytes)||bytes<=0)return null;values[field]=bytes;}
 const {maxFileBytes,image,document,video,audio,totalBytes,userBytes,guestBytes}=values;
 if(maxFileBytes>hardMaxFileBytes||[image,document,video,audio].some(value=>value>maxFileBytes)||userBytes>totalBytes||guestBytes>totalBytes)return null;
 return{maxFileBytes,byType:{image,document,video,audio},totalBytes,userBytes,guestBytes};
}
