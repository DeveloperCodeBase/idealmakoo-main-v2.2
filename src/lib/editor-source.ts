import {ApiError} from './api';

export interface EditorSourceStamp {id:string;version:number;updatedAt:string}

/** The stamp belongs to the content loaded into the editor, not the current
 * workspace clock. An absent source also has an identity: it must remain absent
 * until this editor creates it. */
export function captureEditorSource(source:EditorSourceStamp|undefined|null):EditorSourceStamp|null {
  return source?{id:source.id,version:source.version,updatedAt:source.updatedAt}:null;
}
export function editorSourceMatches(captured:EditorSourceStamp|null,current:EditorSourceStamp|undefined|null):boolean {
  return captured===null?!current:!!current&&captured.id===current.id&&captured.version===current.version&&captured.updatedAt===current.updatedAt;
}
export function assertEditorSource(captured:EditorSourceStamp|null,current:EditorSourceStamp|undefined|null):void {
  if(!editorSourceMatches(captured,current))throw new ApiError({type:'about:blank',title:'Saved content changed',status:409,code:'SOURCE_CHANGED',detail:'The saved content changed after this editor loaded it. Keep or export your draft, then explicitly reload the saved version before editing again.'});
}
