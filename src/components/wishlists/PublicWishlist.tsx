'use client';
import Link from 'next/link';
import type {PublicWishlist as PublicWishlistValue} from '@/types/wishlists';
import {wishlistKey} from '@/lib/wishlist-references';
import {wishlistText as w} from './wishlist-copy';
import './wishlists.css';
/** A capability page takes a public-only server DTO; it never asks for an account session. */
export default function PublicWishlist({wishlist}:{wishlist:PublicWishlistValue}){return <main className="public-wishlist container" data-public-wishlist="" lang={wishlist.locale} dir={['fa','ar'].includes(wishlist.locale)?'rtl':'ltr'}><p>IDEAL MAKOO</p><h1>{wishlist.title}</h1><p><time dateTime={wishlist.expiresAt}>{new Intl.DateTimeFormat(wishlist.locale,{dateStyle:'long',timeStyle:'short'}).format(new Date(wishlist.expiresAt))}</time></p>{!wishlist.items.length&&<p>{w('shareEmpty',wishlist.locale)}</p>}<div className="wishlist-catalog-grid">{wishlist.items.map(item=><article key={wishlistKey(item.reference)} data-wishlist-content={wishlistKey(item.reference)}>{item.imageUrl&&<img src={item.imageUrl} alt="" width={120} height={100} loading="lazy"/>}<h2><Link href={item.href} prefetch={false}>{item.title}</Link></h2><p>{item.summary}</p></article>)}</div></main>;}
