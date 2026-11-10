import Image from 'next/image';
import type {ImgHTMLAttributes} from 'react';
import dimensions from '@/data/public-image-dimensions.json';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width' | 'height' | 'ref'> & {
  src: string;
  alt: string;
  width?: number;
  height?: number;
};

/** Optimize only byte-for-byte known, bundled public artwork. Protected media,
 * authored remote URLs and data URLs keep their original transport semantics. */
export default function PublicImage({src,alt,width,height,sizes,loading,decoding,...props}: Props) {
  const intrinsic = (dimensions as Record<string, number[]>)[src];
  if (!intrinsic) return <img src={src} alt={alt} width={width} height={height} sizes={sizes} loading={loading} decoding={decoding ?? 'async'} {...props}/>;
  return <Image src={src} alt={alt} width={width ?? intrinsic[0]} height={height ?? intrinsic[1]} sizes={sizes ?? '(max-width: 700px) 92vw, (max-width: 1100px) 45vw, 540px'} loading={loading ?? 'lazy'} decoding={decoding ?? 'async'} {...props}/>;
}
