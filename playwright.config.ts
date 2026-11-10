import {defineConfig,devices} from '@playwright/test';
import {existsSync} from 'node:fs';

if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const baseURL=process.env.PLAYWRIGHT_BASE_URL||process.env.SITE_URL||'http://127.0.0.1:3000';

export default defineConfig({
  globalSetup:'./tests/e2e/global-setup.ts',
  testDir:'./tests/e2e',
  fullyParallel:false,
  workers:1,
  forbidOnly:!!process.env.CI,
  retries:process.env.CI?1:0,
  timeout:90_000,
  expect:{timeout:15_000},
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL,trace:'retain-on-failure',screenshot:'only-on-failure',video:'off',locale:'en-US',reducedMotion:'reduce',serviceWorkers:'block',...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}}:{})},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
  webServer:process.env.PLAYWRIGHT_NO_SERVER==='true'?undefined:{
    command:'npm run start',
    url:`${baseURL}/api/v1/health/ready`,
    reuseExistingServer:!process.env.CI,
    timeout:120_000,
    env:{NODE_ENV:'production'},
    stdout:'ignore',stderr:'pipe',
  },
});
