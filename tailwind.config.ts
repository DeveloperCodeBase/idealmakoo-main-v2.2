import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class','[data-theme="dark"]'],
  corePlugins: { preflight: false },
  theme: { extend: { colors: { accent:'var(--accent)', panel:'var(--panel)', foreground:'var(--text)' }, borderRadius: { glass:'28px' } } },
  plugins: [],
} satisfies Config;
