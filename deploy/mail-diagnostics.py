#!/usr/bin/env python3
"""Read-only domain mail readiness: DNS, TLS and authenticated SMTP/IMAP, no message."""
import argparse
import importlib.util
import imaplib
import ipaddress
import json
from pathlib import Path
import re
import smtplib
import socket
import ssl
import subprocess

spec=importlib.util.spec_from_file_location('mail_diagnostic_config',Path(__file__).with_name('mail-config.py'))
config=importlib.util.module_from_spec(spec);spec.loader.exec_module(config)

def query(name, kind):
    result=subprocess.run(['dig','+time=3','+tries=1','+short',name,kind],capture_output=True,text=True,timeout=5,check=False)
    if result.returncode: raise ValueError('DNS query failed')
    return [line.strip().replace('" "','').strip('"') for line in result.stdout.splitlines() if line.strip()]

def reverse_lookup(address):
    names = query(ipaddress.ip_address(address).reverse_pointer, 'PTR')
    if not names:
        raise OSError('Reverse DNS record missing')
    return names[0], names[1:], [address]

def dns_checks(values, resolver=query, lookup=reverse_lookup):
    c=config.configuration(values)
    if c['mode']!='local':return []
    checks=[]
    def check(name,passed,help):checks.append({'check':name,'ready':bool(passed),'help':help})
    addresses=resolver(c['hostname'],'A')+resolver(c['hostname'],'AAAA')
    public=[]
    for value in addresses:
        try:
            if ipaddress.ip_address(value).is_global:public.append(value)
        except ValueError:pass
    check('mail-address',public and (not values.get('MAIL_PUBLIC_IP') or values['MAIL_PUBLIC_IP'] in public),'Create DNS-only A/AAAA for MAIL_HOSTNAME; it must resolve to this server, not a CDN HTTP proxy.')
    mx=resolver(c['domain'],'MX')
    check('mail-mx',any(line.split()[-1].rstrip('.').lower()==c['hostname'] for line in mx),'Add the MX record from mail-server/dns-records.json after reviewing any existing mail provider.')
    spf=[v for v in resolver(c['domain'],'TXT') if v.lower().startswith('v=spf1')]
    check('mail-spf',len(spf)==1 and (' mx' in spf[0] or ' include:' in spf[0] or ' ip4:' in spf[0] or ' ip6:' in spf[0]),'Publish exactly one SPF record authorizing the actual sender or relay provider.')
    expected=json.loads((Path(c['directory'])/'dns-records.json').read_text())
    dkim=next(x['value'] for x in expected['records'] if x['name'].startswith('mail._domainkey.'))
    check('mail-dkim',any(re.sub(r'\s+','',v)==re.sub(r'\s+','',dkim) for v in resolver('mail._domainkey.'+c['domain'],'TXT')),'Copy the generated public DKIM TXT record exactly; never publish the private key.')
    dmarc=[v for v in resolver('_dmarc.'+c['domain'],'TXT') if v.lower().startswith('v=dmarc1;')]
    check('mail-dmarc',len(dmarc)==1 and bool(re.search(r'(?:^|;)\s*p=(none|quarantine|reject)(?:;|$)',dmarc[0])),'Add one DMARC record; start with monitoring and review reports before stricter policy.')
    if not c['relay']:
        ptr=False
        for address in public:
            try:
                name,aliases,_=lookup(address)
                if c['hostname'] in [n.rstrip('.').lower() for n in [name,*aliases]]:ptr=True
            except OSError:pass
        check('mail-ptr',ptr,'Ask the IP/server provider to set reverse DNS/PTR to MAIL_HOSTNAME. Direct SMTP delivery also requires outbound TCP25.')
    return checks

def smtp_checks(values,connect=smtplib.SMTP_SSL):
    c=config.configuration(values)
    if c['mode']!='local':return []
    try:
        with connect(c['hostname'],465,timeout=10,context=ssl.create_default_context()) as client:
            client.ehlo();client.login(c['service'],values['MAIL_SERVICE_PASSWORD'])
        return [{'check':'mail-tls-auth','ready':True,'help':'TLS chain/hostname and service authentication passed. No message was sent.'}]
    except (OSError,smtplib.SMTPException,ValueError,KeyError):
        return [{'check':'mail-tls-auth','ready':False,'help':'Check mail certificate, public465 reachability, DMS health and service credentials. No TLS exception is permitted.'}]

def imap_checks(values, connect=imaplib.IMAP4_SSL):
    c = config.configuration(values)
    if c['mode'] != 'local':
        return []
    try:
        with connect(c['hostname'], 993, timeout=10, ssl_context=ssl.create_default_context()) as client:
            status, _ = client.login(c['service'], values['MAIL_SERVICE_PASSWORD'])
            if status != 'OK':
                raise ValueError('IMAP authentication refused')
        return [{'check': 'mail-imap-auth', 'ready': True, 'help': 'IMAP TLS and authentication passed. No mailbox content was read.'}]
    except (OSError, imaplib.IMAP4.error, ValueError, KeyError):
        return [{'check': 'mail-imap-auth', 'ready': False, 'help': 'Check certificate, public993 reachability, Dovecot and account credentials.'}]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--env-file',required=True)
    scope=p.add_mutually_exclusive_group();scope.add_argument('--dns-only',action='store_true');scope.add_argument('--tls-only',action='store_true');a=p.parse_args()
    values=config.reader.read(a.env_file)
    checks=[] if a.tls_only else dns_checks(values)
    if not a.dns_only:checks+=smtp_checks(values)+imap_checks(values)
    print(json.dumps({'format':1,'checks':checks,'scope':'DNS and SMTP/IMAP authentication only; external deliverability is not proven'},indent=2))
    return 0 if all(c['ready'] for c in checks) else 1

if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,OSError,subprocess.SubprocessError):raise SystemExit('Mail DNS/readiness check failed. Review DNS records and protected settings; no email was sent.') from None
