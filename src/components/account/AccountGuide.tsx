'use client';
import Link from 'next/link';
import {useApp} from '@/components/providers/AppProvider';
import {accountGuide} from './account-help';
import {useAccountText} from './portal-ui';
import styles from './account.module.css';

export default function AccountGuide({section}:{section:string}){
 const {locale,href}=useApp(),text=useAccountText(),guide=accountGuide(section);
 return <div data-account-help={section||'overview'}><ol>{guide.steps.map((step,index)=><li key={index}><p>{step[locale]}</p></li>)}</ol><div className={styles.panelActions}><a className={styles.secondaryButton} href="/manuals/customer.html" target="_blank" rel="noreferrer">{locale==='fa'?'راهنمای تصویری مشتری':locale==='ar'?'دليل العميل المصور':locale==='tr'?'Resimli müşteri kılavuzu':locale==='ru'?'Руководство клиента':'Illustrated customer manual'}</a>{guide.related.map(link=><Link className={styles.secondaryButton} key={link.path} href={href(link.path)}>{text(link.label)}</Link>)}</div></div>;
}
