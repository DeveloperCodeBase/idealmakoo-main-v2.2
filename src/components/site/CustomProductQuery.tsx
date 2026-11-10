'use client';

import {useSearchParams} from 'next/navigation';
import {ProductDetail} from './Products';

/** The legacy custom-product URL keeps its query parameter on the client. */
export default function CustomProductQuery(){
  const params=useSearchParams();
  return <ProductDetail id={params.get('id')||''}/>;
}
