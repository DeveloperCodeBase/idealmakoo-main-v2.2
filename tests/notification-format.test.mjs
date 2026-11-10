import test from 'node:test';
import assert from 'node:assert/strict';
import {smsMeasure,fitNotificationMessage,notificationHtml,safeNotificationLink} from '../src/server/notification-format.ts';
import {normalizeCustomerPhone} from '../src/server/customer-otp.ts';
import {sendChannelNotification} from '../src/server/notification-providers.ts';
import {sendEmailNotification} from '../src/server/notification-email.ts';

test('customer phone normalization accepts Persian/Arabic digits and international notation without accepting prose',()=>{
  for(const phone of ['۰۹۱۲۳۴۵۶۷۸۹','٠٩١٢٣٤٥٦٧٨٩','09123456789','00989123456789','+98 (912) 345-6789','989123456789'])assert.equal(normalizeCustomerPhone(phone),'+989123456789');
  for(const phone of ['hello09123456789','0912','+00981234567890','+989123456789<script>'])assert.throws(()=>normalizeCustomerPhone(phone));
});
test('SMS size uses GSM extension septets, Unicode units and multipart boundaries',()=>{
  assert.equal(smsMeasure('A'.repeat(160)).segments,1);assert.equal(smsMeasure('A'.repeat(161)).segments,2);
  assert.equal(smsMeasure('^'.repeat(80)).segments,1);assert.equal(smsMeasure('^'.repeat(81)).segments,2);
  assert.equal(smsMeasure('ف'.repeat(70)).segments,1);assert.equal(smsMeasure('ف'.repeat(71)).segments,2);
  assert.equal(smsMeasure('😀'.repeat(35)).segments,1);assert.equal(smsMeasure('😀'.repeat(36)).segments,2);
});
test('channel fitting retains both action and preference links and never splits an emoji',()=>{
  const links=['https://example.invalid/fa/products/a/','https://example.invalid/fa/communication-preferences/xyz/'];
  const message=fitNotificationMessage('عنوان محصول','😀 متن محصول '.repeat(200),links,6,value=>smsMeasure(value).segments);
  assert.ok(smsMeasure(message).segments<=6);for(const link of links)assert.ok(message.includes(link));assert.ok(!message.includes('\ufffd'));
  assert.ok([...fitNotificationMessage('Title','x'.repeat(3000),links,1024)].length<=1024);
  assert.throws(()=>fitNotificationMessage('title','body',['x'.repeat(30)],20));
});
test('responsive notification HTML escapes all authored values and preserves RTL and unsubscribe',()=>{
  const html=notificationHtml({title:'<img src=x onerror=bad>',body:'<script>bad</script>',locale:'fa',link:'https://example.invalid/?a="x"',image:'https://example.invalid/a.jpg',unsubscribe:{url:'https://example.invalid/unsubscribe/',label:'لغو عضویت'}});
  assert.ok(html.includes('dir="rtl"'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('لغو عضویت'));
});
test('provider contract sends Telegram photo with bounded caption and captures actual Kavenegar IRR cost',{concurrency:false},async()=>{
  const old={...process.env};Object.assign(process.env,{NOTIFICATIONS_MODE:'live',SITE_URL:'https://example.invalid',SESSION_SECRET:'isolated-format-test-secret-length-32',MFA_ENCRYPTION_KEY:'8'.repeat(64),TELEGRAM_BOT_TOKEN:'123:isolated-fixture',KAVENEGAR_API_KEY:'isolated-fixture',KAVENEGAR_SENDER:'1000'});
  try{
    let sent;
    const tg=await sendChannelNotification('id','telegram',{to:'42',title:'Title',body:'😀 Long body '.repeat(500),href:'/fa/news/one/',imageUrl:'/media/one.jpg'},false,async(url,options)=>{assert.ok(url.endsWith('/sendPhoto'));sent=JSON.parse(options.body);return Response.json({ok:true,result:{message_id:1,chat:{id:42}}});});
    assert.equal(sent.photo,'https://example.invalid/media/one.jpg');assert.ok(sent.caption.length<=1024);assert.ok(sent.caption.includes('/fa/news/one/'));assert.equal(tg.usage.actualCost,null);
    const sms=await sendChannelNotification('id','sms',{to:'+989123456789',title:'عنوان',body:'متن',href:'/fa/news/one/'},false,async()=>Response.json({return:{status:200},entries:[{messageid:123,cost:900,message:'پیام کامل'}]}));
    assert.equal(sms.usage.actualCost,900);assert.equal(sms.usage.currency,'IRR');
    await assert.rejects(sendChannelNotification('id','sms',{to:'+989123456789',title:'Title',body:'Body'},false,async()=>Response.json({return:{status:200},entries:[]})),error=>error.code==='DELIVERY_UNCERTAIN');
    await assert.rejects(sendChannelNotification('id','telegram',{to:'42',title:'Title',body:'Body'},false,async()=>Response.json({ok:false})),error=>error.code==='TELEGRAM_REJECTED');
  }finally{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);}
});
test('SMTP mail has a plain and HTML action link and refuses internal phone identity addresses',{concurrency:false},async()=>{
  const old={...process.env};Object.assign(process.env,{NOTIFICATIONS_MODE:'live',SITE_URL:'https://example.invalid',SESSION_SECRET:'isolated-format-test-secret-length-32',MFA_ENCRYPTION_KEY:'8'.repeat(64),SMTP_HOST:'smtp.example.invalid',SMTP_FROM:'notifications@example.invalid',SMTP_DKIM_MODE:'off'});
  try{let sent;await sendEmailNotification('mail-test',{to:'person@example.invalid',title:'عنوان',body:'متن',locale:'fa',href:'/fa/news/a/'},false,async message=>{sent=message;return {accepted:['person@example.invalid'],messageId:'fake'};});assert.ok(sent.text.includes('https://example.invalid/fa/news/a/'));assert.ok(sent.html.includes('https://example.invalid/fa/news/a/'));assert.equal(sent.disableFileAccess,true);assert.equal(sent.disableUrlAccess,true);
    await assert.rejects(sendEmailNotification('mail-test',{to:'phone.id@identity.invalid',body:'text'},false,async()=>{throw new Error('must not send');}),error=>error.code==='RECIPIENT');
    for(const path of ['//evil.invalid','/\\evil.invalid','/bad\npath','/%5cevil'])assert.throws(()=>safeNotificationLink(path));
  }finally{for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);}
});
