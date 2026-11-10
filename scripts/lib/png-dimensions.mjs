/** Inspect PNG IHDR dimensions without trusting a filename or manifest label. */
export function pngDimensions(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<33
  ||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  ||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return null;
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 return width>0&&height>0?{width,height}:null;
}

export function pngMatchesDeclaredSize(bytes,sizes){
 const dimensions=pngDimensions(bytes);
 return !!dimensions&&typeof sizes==='string'
  &&sizes.trim().split(/\s+/).includes(`${dimensions.width}x${dimensions.height}`);
}
