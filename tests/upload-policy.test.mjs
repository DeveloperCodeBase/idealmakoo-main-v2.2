import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {effectiveFileLimit,HARD_MAX_UPLOAD_BYTES,MULTIPART_OVERHEAD_BYTES,UPLOAD_MIME_TYPES}=await loadTs('src/lib/upload-policy.ts');
test('The upload contract distinguishes file types and one binary byte ceiling',()=>{
 const policy={maxFileBytes:1000,byType:{image:100,document:200,video:1500,audio:400}};
 assert.equal(effectiveFileLimit(policy,'image/png'),100);assert.equal(effectiveFileLimit(policy,'application/pdf'),200);assert.equal(effectiveFileLimit(policy,'video/mp4'),1000);assert.equal(effectiveFileLimit(policy,'audio/wav'),400);
 assert.equal(HARD_MAX_UPLOAD_BYTES+MULTIPART_OVERHEAD_BYTES,83951616);assert.equal(UPLOAD_MIME_TYPES.includes('text/html'),false);assert.equal(UPLOAD_MIME_TYPES.includes('image/svg+xml'),false);
});
