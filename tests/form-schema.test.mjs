import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
const { parseFormSchema, validateFormValues } = await loadTs('src/lib/form-schema.ts');
const text = value => ({fa:value,en:value,tr:value,ar:value,ru:value});
const field = (id, extra = {}) => ({id,label:text(id),type:'text',required:false,...extra});
const schema = fields => ({id:'factory-form',title:text('Factory form'),version:1,fields});

test('published form schema excludes all collected responses and unexpected fields', () => {
  const parsed = parseFormSchema({...schema([field('organization')]),responses:[{email:'private@example.invalid'}],token:'never-publish'});
  assert.equal(parsed.fields[0].id,'organization');
  assert.equal('responses' in parsed,false);
  assert.equal('token' in parsed,false);
});
test('duplicate identifiers, forward conditions and unsafe property identifiers invalidate schemas', () => {
  for (const fields of [[field('one'),field('one')],[field('one',{condition:'later'}),field('later')],[field('__proto__')]]) assert.equal(parseFormSchema(schema(fields)),null);
  assert.equal(parseFormSchema({...schema([]),version:-1}),null);
});
test('hidden descendants discard old answers and do not trigger required errors', () => {
  const form = parseFormSchema(schema([field('organization'),field('branch',{condition:'organization',required:true}),field('detail',{condition:'branch',required:true})]));
  const checked = validateFormValues(form,{organization:'',branch:'stale branch',detail:'stale detail',unknown:'ignored'});
  assert.deepEqual(checked.values,{organization:''});
  assert.deepEqual(checked.errors,[]);
});
test('visible inputs reject unavailable options, invalid calendar dates and malformed email', () => {
  const form = parseFormSchema(schema([field('email',{type:'email',required:true}),field('date',{type:'date'}),field('material',{type:'select',options:['A','B']})]));
  assert.deepEqual(validateFormValues(form,{email:'bad',date:'2026-02-31',material:'invented'}).errors.map(e=>e.code),['email','date','option']);
  assert.deepEqual(validateFormValues(form,{email:'test@example.invalid',date:'2028-02-29',material:'A'}).errors,[]);
});
test('identity contracts cannot become unsatisfiable dropdowns or conditional fields', () => {
  assert.equal(parseFormSchema(schema([field('email',{type:'select',required:true,options:['1','2']})])),null);
  assert.equal(parseFormSchema(schema([field('name',{required:false})])),null);
  assert.equal(parseFormSchema(schema([field('trigger'),field('email',{type:'email',required:true,condition:'trigger'})])),null);
  assert.equal(parseFormSchema(schema([field('material',{type:'select',required:true,options:[]})])),null);
});
