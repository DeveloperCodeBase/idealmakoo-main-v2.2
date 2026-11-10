declare module 'bidi-js' {
  interface Embedding {levels:Uint8Array;paragraphs:{start:number;end:number;level:number}[]}
  export default function bidiFactory():{
    getEmbeddingLevels(text:string,direction?:'rtl'|'ltr'):Embedding;
    getMirroredCharactersMap(text:string,embedding:Embedding):Map<number,string>;
  };
}
