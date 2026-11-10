'use client';
import ProductEditor from './ProductEditor';
import {RecordsDesk} from './Records';
import type {WorkspaceStore} from './store';

export default function ProductWorkspace({store}:{store:WorkspaceStore}){
 return <><ProductEditor key={`${store.locale}-${store.loaded}`} store={store}/><RecordsDesk collection="products" store={store}/></>;
}
