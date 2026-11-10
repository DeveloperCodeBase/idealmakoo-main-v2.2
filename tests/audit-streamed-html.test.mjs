import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStreamedMain} from '../scripts/lib/audit-streamed-html.mjs';

test('metadata inspects actual server-streamed main content without executing scripts or counting the footer',()=>{
 const result=resolveStreamedMain('<html><head><title>Page</title></head><body><main><!--$--><!--$?--><template id="B:0"></template><div>Loading</div><!--/$--><!--/$--></main><footer><h1>Unrelated footer</h1></footer><div hidden id="S:0"><section><h1>عنوان فارسی</h1><div><p>متن کامل</p></div></section></div><script>throw new Error("must not execute"); const value="<main><h1>Injected data</h1></main>";</script></body></html>');
 assert.equal(result.mainCount,1);assert.equal(result.h1Count,1);assert.equal(result.streaming.rawMainH1Count,0);assert.equal(result.streaming.rawDocumentH1Count,2);assert.equal(result.streaming.resolvedBoundaries,1);assert.match(result.mainHtml,/عنوان فارسی/);assert.match(result.mainHtml,/متن کامل/);assert.doesNotMatch(result.mainHtml,/Loading|footer|Injected/);assert.deepEqual(result.errors,[]);assert.deepEqual(result.warnings,[]);
});

test('nested and direct SSR, escaped attributes and ordinary Suspense comments preserve their exact content',()=>{
 const nested=resolveStreamedMain('<main><!--$?--><template id="B:0"></template><p>Wait</p><!--/$--></main><div hidden="" id="S:0"><h1>Heading</h1><!--$?--><template id="B:1"></template><div>Wait2</div><!--/$--></div><div hidden id="S:1"><p title="a > b">Resolved nested text</p></div>');
 assert.equal(nested.h1Count,1);assert.equal(nested.streaming.resolvedBoundaries,2);assert.match(nested.mainHtml,/<p title="a > b">Resolved nested text<\/p>/);assert.deepEqual(nested.errors,[]);assert.deepEqual(nested.warnings,[]);
 const direct=resolveStreamedMain('<main><!--$--><h1>Direct</h1><p>Text<br/>next</p><!--/$--></main>');assert.equal(direct.h1Count,1);assert.equal(direct.streaming.segmentCount,0);assert.deepEqual(direct.errors,[]);
});

test('missing, duplicate, cyclic and unsupported stream segments never become a false heading pass',()=>{
 const missing=resolveStreamedMain('<main><!--$?--><template id="B:0"></template><p>Wait</p><!--/$--></main><footer><h1>Not the page</h1></footer>');assert.equal(missing.h1Count,0);assert.ok(missing.errors.some(value=>value.includes('Missing streamed')));
 const duplicate=resolveStreamedMain('<main><!--$?--><template id="B:0"></template><!--/$--></main><div hidden id="S:0"><h1>First</h1></div><div hidden id="S:0"><h1>Second</h1></div>');assert.ok(duplicate.errors.some(value=>value.includes('Duplicate')));
 const cyclic=resolveStreamedMain('<main><!--$?--><template id="B:0"></template><!--/$--></main><div hidden id="S:0"><!--$?--><template id="B:0"></template><!--/$--></div>');assert.ok(cyclic.errors.some(value=>value.includes('Cyclic')));
 const unsupported=resolveStreamedMain('<main><template id="B:0"></template></main><div hidden id="S:0"><h1>Unplaced</h1></div>');assert.equal(unsupported.h1Count,0);assert.ok(unsupported.errors.some(value=>value.includes('unsupported')));assert.ok(unsupported.warnings.length);
 const duplicateMain=resolveStreamedMain('<main><h1>First</h1></main><main><h1>Second</h1></main>');assert.equal(duplicateMain.mainCount,2);assert.equal(duplicateMain.h1Count,0);
});
