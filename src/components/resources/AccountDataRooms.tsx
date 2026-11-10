'use client';
import {useEffect,useState} from 'react';
import {useApp} from '@/components/providers/AppProvider';
import type {DataRoomDto} from '@/types/resources';
import {c,text} from '@/components/controlled/copy';
import {controlledAccountKey,useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import ControlledResources from './ControlledResources';

export default function AccountDataRooms(){const{locale,session}=useApp();return session?<Rooms key={controlledAccountKey(session,locale)}/>:null;}
function Rooms(){const{locale}=useApp(),api=useControlledApi(locale);const[rooms,setRooms]=useState<DataRoomDto[]>([]),[selected,setSelected]=useState(''),[ready,setReady]=useState(false);
 const load=async()=>{const result=await api.request<{items:DataRoomDto[]}>(`/me/data-rooms?locale=${locale}`);setRooms(result.items);setSelected(old=>result.items.some(item=>item.id===old)?old:'');setReady(true);};
 useEffect(()=>{void api.run(load);},[]);
 return <section className={styles.panel}><header className={styles.header}><h2>{text(locale,['اتاق اسناد اختصاصی','Your data rooms','Belge odalarınız','غرف مستنداتك','Ваши комнаты данных'])}</h2><button className="btn" disabled={api.busy} onClick={()=>void api.run(load)}>{c(locale,'refresh')}</button></header>{api.error&&<p role="alert" className={styles.error}>{api.error}</p>}{!ready&&!api.error&&<p role="status">{c(locale,'loading')}</p>}{ready&&!rooms.length&&<p className={styles.notice}>{c(locale,'empty')}</p>}<div className={styles.grid}>{rooms.map(room=><button type="button" className={styles.choice} key={room.id} aria-pressed={selected===room.id} onClick={()=>setSelected(room.id)}><strong>{room.title}</strong><span>{room.summary}</span><small>{room.permissions.download?c(locale,'download'):c(locale,'view')}</small></button>)}</div>{selected&&<ControlledResources roomId={selected}/>}</section>;
}
