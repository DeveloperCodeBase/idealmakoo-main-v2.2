import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {passwordHash} from '../../src/server/crypto';

// Exercise the real built HTTP server. Handler-only tests cannot detect a
// framework Proxy silently truncating bytes before multipart parsing.
test('private multipart uploads survive the framework buffer while current size and malformed-body guards remain active',async({request})=>{
  test.setTimeout(120000);
  const database=process.env.TEST_DATABASE_URL||process.env.DATABASE_URL;
  if(!database)throw new Error('Upload acceptance requires an explicitly disposable database.');
  const pool=new pg.Pool({connectionString:database,max:1}),id=randomUUID();
  const origin=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';
  const password=`Upload-only-${randomUUID()}-A9`,email=`upload-boundary-${id}@example.test`;
  const pdf=(size:number)=>{
    const parts:Buffer[]=[Buffer.from('%PDF-1.4\n')],offsets=[0];
    const length=()=>parts.reduce((sum,part)=>sum+part.length,0),append=(value:string|Buffer)=>parts.push(typeof value==='string'?Buffer.from(value):value);
    const object=(number:number,value:string)=>{offsets[number]=length();append(`${number} 0 obj\n${value}\nendobj\n`);};
    object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>');
    const streamLength=size-1024;offsets[4]=length();append(`4 0 obj\n<< /Length ${streamLength} >>\nstream\n`);append(Buffer.alloc(streamLength,32));append('\nendstream\nendobj\n');
    const xref=length();append('xref\n0 5\n0000000000 65535 f \n');for(let i=1;i<=4;i++)append(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    append(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n`);append(Buffer.alloc(size-length()-6,32));append('%%EOF\n');return Buffer.concat(parts);
  };
  try{
    await pool.query("INSERT INTO users(id,email,name,password_hash,role,email_verified,allowed_locales) VALUES($1,$2,$3,$4,'customer',true,$5::jsonb)",[id,email,'Owned upload boundary fixture',await passwordHash(password),JSON.stringify(['fa','en','tr','ar','ru'])]);
    await pool.query('INSERT INTO user_settings(user_id) VALUES($1)',[id]);
    let session=await(await request.get('/api/v1/auth/session')).json();
    expect((await request.post('/api/v1/auth/login',{headers:{Origin:origin,'X-CSRF-Token':session.csrfToken},data:{email,password}})).status()).toBe(200);
    session=await(await request.get('/api/v1/auth/session')).json();expect(session.user.id).toBe(id);
    const policy=await(await request.get('/api/v1/media/policy')).json();
    expect(policy.maxFileBytes).toBeGreaterThanOrEqual(12*1024*1024);expect(policy.maxFileBytes).toBeLessThanOrEqual(80*1024*1024);
    expect(policy.byType.document).toBeGreaterThanOrEqual(12*1024*1024);
    for(const size of[64*1024,12*1024*1024]){
      const bytes=pdf(size),response=await request.post('/api/v1/attachments',{headers:{Origin:origin,'X-CSRF-Token':session.csrfToken},multipart:{file:{name:'owned-boundary.pdf',mimeType:'application/pdf',buffer:bytes},visibility:'private'}});
      expect(response.status()).toBe(201);expect(response.headers()['cache-control']).toContain('no-store');expect(response.headers()['x-content-type-options']).toBe('nosniff');
      expect(response.headers()['content-security-policy']).toContain("default-src 'none'");
      const asset=await response.json(),stored=(await pool.query('SELECT bytes::text,sha256,visibility FROM assets WHERE id=$1 AND owner_id=$2',[asset.id,id])).rows[0];
      expect(asset.size).toBe(size);expect(Number(stored.bytes)).toBe(size);expect(stored.visibility).toBe('private');expect(stored.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    const before=(await pool.query('SELECT count(*)::int AS count FROM assets WHERE owner_id=$1',[id])).rows[0].count;
    const over=await request.post('/api/v1/attachments',{headers:{Origin:origin,'X-CSRF-Token':session.csrfToken},multipart:{file:{name:'too-large.pdf',mimeType:'application/pdf',buffer:pdf(policy.maxFileBytes+1)},visibility:'private'}});
    expect(over.status()).toBe(413);expect((await over.json()).code).toBe('UPLOAD_SIZE');
    const malformed=await request.post('/api/v1/attachments',{headers:{Origin:origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'multipart/form-data; boundary=isolated'},data:Buffer.from('--isolated\r\nContent-Disposition: form-data; name="file"; filename="incomplete.pdf"\r\n\r\n%PDF-1.4\nmissing final boundary')});
    expect(malformed.status()).toBe(400);expect((await malformed.json()).code).toBe('MULTIPART_INVALID');
    expect((await pool.query('SELECT count(*)::int AS count FROM assets WHERE owner_id=$1',[id])).rows[0].count).toBe(before);
    expect((await pool.query("SELECT count(*)::int AS count FROM storage_reservations WHERE subject_key=$1 AND state='reserved'",['user:'+id])).rows[0].count).toBe(0);
  }finally{
    await pool.query('UPDATE users SET active=false WHERE id=$1',[id]);await pool.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[id]);await pool.end();
  }
});
