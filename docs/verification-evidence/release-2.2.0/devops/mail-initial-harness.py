import email, email.message, email.utils, hashlib, imaplib, importlib.util, json, os, pathlib, re, smtplib, ssl, subprocess, time
root=pathlib.Path('/srv/idealmakoo-mail-current');release=root/'release';env=root/'shared/.env'
def module(name):
    spec=importlib.util.spec_from_file_location(name,release/'deploy'/f'{name}.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
reader=module('env-file');values=reader.read(env);ctx=ssl.create_default_context(cafile=str(root/'tls/mail.example.test.crt'))
received={}
with smtplib.SMTP_SSL('mail.example.test',465,context=ctx,timeout=15) as client:
    client.login(values['SMTP_USER'],values['SMTP_PASSWORD'])
    message=email.message.EmailMessage();message['From']=values['SMTP_USER'];message['To']=values['SMTP_USER'];message['Subject']='Isolated local IdealMakoo acceptance'
    message['Message-ID']='<idealmakoo-local-220@example.test>';message.set_content('Controlled fixture message. No external recipient or user content.')
    message['Date']=email.utils.formatdate(usegmt=True)
    message['List-Unsubscribe']='<https://example.test/unsubscribe/local-fixture>'
    message['List-Unsubscribe-Post']='List-Unsubscribe=One-Click'
    client.send_message(message)
for attempt in range(20):
    with imaplib.IMAP4_SSL('mail.example.test',993,ssl_context=ctx,timeout=10) as client:
        client.login(values['SMTP_USER'],values['SMTP_PASSWORD']);client.select('INBOX')
        status,ids=client.search(None,'HEADER','Message-ID','"<idealmakoo-local-220@example.test>"')
        if ids[0]:
            status,rows=client.fetch(ids[0].split()[-1],'(RFC822)');raw=next(row[1] for row in rows if isinstance(row,tuple));received=email.message_from_bytes(raw);break
    time.sleep(2)
assert received and received.get('DKIM-Signature'), 'Local mailbox delivery must include an actual Rspamd DKIM signature'
headers=re.search(r'(?:^|;)\s*h=(.*?);',received['DKIM-Signature'],re.S)
assert headers and {'from','to','subject','list-unsubscribe','list-unsubscribe-post'} <= {x.strip().lower() for x in headers.group(1).split(':')}, 'DKIM must sign both one-click unsubscribe headers'
with smtplib.SMTP_SSL('mail.example.test',465,context=ctx,timeout=10) as client:
    client.ehlo();client.mail('unauthorized@example.test');code,_=client.rcpt('fixture-recipient@another.example.test');assert code>=500, 'Unauthenticated relay must be rejected before any message data'
dc=['python3',str(release/'deploy/compose.py'),str(release),str(env)]
lifecycle=['python3',str(release/'deploy/service-lifecycle.py'),'--root',str(release),'--env-file',str(env)]
subprocess.run(lifecycle+['snapshot','--output',str(root/'snapshot.json'),'--timeout','30'],check=True)
captured=json.loads((root/'snapshot.json').read_text());assert [x['service'] for x in captured['services']]==['mailserver']
key=root/'mail-server/config/rspamd/dkim/example.test.mail.key';before=hashlib.sha256(key.read_bytes()).hexdigest()
subprocess.run(lifecycle+['stop','--snapshot',str(root/'snapshot.json'),'--timeout','90'],check=True)
payload=root/'backup-payload';payload.mkdir();data=module('mail-data');data.snapshot(env,payload);data.validate_manifest(payload);data.restore(env,payload)
assert hashlib.sha256(key.read_bytes()).hexdigest()==before
subprocess.run(lifecycle+['start','--snapshot',str(root/'snapshot.json'),'--timeout','360'],check=True)
assert reader.read(env)['MAIL_OUTBOUND_ENABLED']=='false'
with imaplib.IMAP4_SSL('mail.example.test',993,ssl_context=ctx,timeout=10) as client:
    client.login(values['SMTP_USER'],values['SMTP_PASSWORD']);client.select('INBOX');status,ids=client.search(None,'HEADER','Message-ID','"<idealmakoo-local-220@example.test>"');assert ids[0]
subprocess.run(['bash',str(release/'scripts/mail-certificate-refresh.sh')],check=True)
record={'localTlsAuth':True,'localSmtpToImapDelivered':True,'dkimSignaturePresent':True,'dkimSignsUnsubscribeHeaders':True,'unauthenticatedRelayRejected':True,'exactOwnedLifecycleAndMailArchiveRestore':True,'restoredOutboundPaused':True,'certificateRefreshCommandPassed':True,'externalMessages':0,'publicDnsOrDeliverabilityProven':False}
(root/'mail-acceptance.safe.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
