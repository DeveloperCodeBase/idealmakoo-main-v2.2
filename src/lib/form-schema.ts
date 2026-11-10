import type { ContentLocale, Localized } from '@/data/catalog';

export interface PublicFormField {
  id: string;
  label: Localized;
  type: 'text' | 'email' | 'textarea' | 'select' | 'date';
  required: boolean;
  options?: string[];
  condition?: string;
}
export interface PublicFormSchema { id: string; title: Localized; fields: PublicFormField[]; version: number }
const locales: ContentLocale[] = ['fa', 'en', 'tr', 'ar', 'ru'];
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
function label(value: unknown): Localized | null {
  if (!isObject(value) || locales.some(locale => typeof value[locale] !== 'string')) return null;
  return Object.fromEntries(locales.map(locale => [locale, (value[locale] as string).slice(0, 300)])) as Localized;
}
/** A publication contains the reviewed form schema only, never its collected responses. */
export function parseFormSchema(value: unknown): PublicFormSchema | null {
  if (!isObject(value) || !safeId(value.id) || !Number.isInteger(value.version) || Number(value.version) < 1 || !Array.isArray(value.fields) || value.fields.length > 50) return null;
  const title = label(value.title);
  if (!title) return null;
  const fields: PublicFormField[] = [];
  const seen = new Set<string>();
  for (const raw of value.fields) {
    if (!isObject(raw) || !safeId(raw.id) || seen.has(raw.id) || !['text', 'email', 'textarea', 'select', 'date'].includes(String(raw.type))) return null;
    if (['name','email'].includes(raw.id) && (raw.type !== (raw.id === 'email' ? 'email' : 'text') || raw.required !== true || raw.condition)) return null;
    const fieldLabel = label(raw.label);
    if (!fieldLabel || (raw.condition && (typeof raw.condition !== 'string' || !seen.has(raw.condition)))) return null;
    const options = raw.type === 'select' && Array.isArray(raw.options) ? [...new Set(raw.options.filter((option): option is string => typeof option === 'string').map(option => option.trim().slice(0, 300)).filter(Boolean))].slice(0, 100) : undefined;
    if (raw.type === 'select' && raw.required === true && !options?.length) return null;
    fields.push({ id: raw.id, label: fieldLabel, type: raw.type as PublicFormField['type'], required: raw.required === true, ...(options ? {options} : {}), ...(raw.condition ? {condition: raw.condition as string} : {}) });
    seen.add(raw.id);
  }
  return { id: value.id, title, fields, version: value.version as number };
}
export type FormValueError = { id: string; code: 'required' | 'email' | 'date' | 'option' | 'length' };
/** Evaluate conditions in schema order so stale values in hidden fields are never submitted. */
export function validateFormValues(schema: PublicFormSchema, input: Record<string, unknown>): { values: Record<string, string>; errors: FormValueError[] } {
  const values: Record<string, string> = {};
  const errors: FormValueError[] = [];
  for (const field of schema.fields) {
    if (field.condition && !values[field.condition]) continue;
    const raw = input[field.id];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (field.required && !value) errors.push({id: field.id, code: 'required'});
    else if (value.length > (field.type === 'textarea' ? 4000 : 300)) errors.push({id: field.id, code: 'length'});
    else if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push({id: field.id, code: 'email'});
    else if (value && field.type === 'select' && !field.options?.includes(value)) errors.push({id: field.id, code: 'option'});
    else if (value && field.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) errors.push({id: field.id, code: 'date'});
    values[field.id] = value;
  }
  return {values, errors};
}
