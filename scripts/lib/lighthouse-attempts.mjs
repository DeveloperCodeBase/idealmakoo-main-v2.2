import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ATTEMPT=99999;
const fail=code=>{throw Object.assign(new Error(code),{code});};

/**
 * Reserve a new attempt without opening, parsing, or rewriting earlier evidence.
 * Callers still hold their normal whole-run lock. The exclusive claim also
 * prevents concurrent users of this allocator from choosing the same prefix.
 * A claim is allocation evidence only: no navigation, outcome, or time is
 * inferred when a process exits before its child actually measures the page.
 */
export async function reserveAuditAttempt(output,id){
 if(typeof output!=='string'||!output||typeof id!=='string'||!/^[a-f0-9]{16}$/.test(id))fail('AUDIT_ATTEMPT_ARGUMENTS');
 const directory=path.resolve(output),stat=await fs.lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink())fail('AUDIT_ATTEMPT_DIRECTORY');
 const pattern=new RegExp('^'+id+'\\.attempt-([0-9]+)(?:\\.|$)');
 for(;;){
  let highest=0;
  for(const name of await fs.readdir(directory)){
   const match=pattern.exec(name);if(!match)continue;
   const number=Number(match[1]);
   if(!Number.isSafeInteger(number)||number<0||number>=MAX_ATTEMPT)fail('AUDIT_ATTEMPT_LIMIT');
   highest=Math.max(highest,number);
  }
  const attempt=highest+1,prefix=path.join(directory,`${id}.attempt-${attempt}`),reservationFile=prefix+'.reservation.json';
  let claim;
  try{claim=await fs.open(reservationFile,'wx',0o600);}
  catch(error){if(error.code==='EEXIST')continue;throw error;}
  try{
   await claim.writeFile(JSON.stringify({format:'idealmakoo.lighthouse-attempt-reservation',version:1,id,attempt,reservationOnly:true})+'\n');
   await claim.sync();
  }finally{await claim.close();}
  // A legacy artifact can arrive between the first directory read and claim
  // creation. Preserve it and this claim, then advance beyond both. A caller
  // must not run an old, claim-unaware writer outside the normal run lock.
  const stem=path.basename(prefix),claimName=path.basename(reservationFile);
  if((await fs.readdir(directory)).some(name=>name!==claimName&&(name===stem||name.startsWith(stem+'.'))))continue;
  return{attempt,prefix,reservationFile};
 }
}
