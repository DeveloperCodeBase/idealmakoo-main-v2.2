import {test,expect} from '@playwright/test';

// Real React/Next navigation with a controlled forgot-password transport reply.
// This does not verify mail delivery, password reset, or server authentication.
test('recovery-token navigation restores login and forgot forms and sends the English recovery locale',async({page})=>{
 const forgotRoute='**/api/v1/auth/password/forgot';
 const submittedBodies:unknown[]=[];
 await page.route(forgotRoute,async route=>{
  if(route.request().method()!=='POST')return route.continue();
  submittedBodies.push(route.request().postDataJSON());
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
 });
 try{
  // This fixture token is never submitted to a reset endpoint.
  const response=await page.goto('/en/auth/recover/?token=test_auth_recovery_browser_fixture_2026');
  expect(response?.status()).toBe(200);
  const auth=page.locator('main[data-page-shell="auth"]');
  const form=auth.locator('form');
  await expect(form.locator('input[name="password"]')).toBeVisible();
  await expect(form.locator('input[name="password"]')).toHaveAttribute('autocomplete','new-password');
  await expect(form.locator('input[name="confirmPassword"]')).toBeVisible();
  await expect(form.locator('input[name="email"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/en\/auth\/recover\/?$/);
  await page.evaluate(()=>{
   (window as typeof window&{__authNavigationFixture?:string}).__authNavigationFixture='test_auth_same_document';
  });

  await auth.getByRole('link',{name:'Sign in',exact:true}).first().click();
  await expect(page).toHaveURL(/\/en\/auth\/login\/?$/);
  await expect(form.locator('input[name="email"]')).toBeVisible();
  await expect(form.locator('input[name="email"]')).toHaveAttribute('required','');
  await expect(form.locator('input[name="password"]')).toBeVisible();
  await expect(form.locator('input[name="password"]')).toHaveAttribute('autocomplete','current-password');
  await expect(form.locator('input[name="confirmPassword"]')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as typeof window&{__authNavigationFixture?:string}).__authNavigationFixture)).toBe('test_auth_same_document');

  await form.getByRole('link',{name:'Recover password',exact:true}).click();
  await expect(page).toHaveURL(/\/en\/auth\/recover\/?$/);
  await expect(form.locator('input[name="email"]')).toBeVisible();
  await expect(form.locator('input[name="password"]')).toHaveCount(0);
  await expect(form.locator('input[name="confirmPassword"]')).toHaveCount(0);
  expect(await page.evaluate(()=>(window as typeof window&{__authNavigationFixture?:string}).__authNavigationFixture)).toBe('test_auth_same_document');

  await form.locator('input[name="email"]').fill('test-auth-navigation@example.test');
  const submitted=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/auth/password/forgot'&&request.method()==='POST',{timeout:15000});
  await form.locator('button[type="submit"]').click();
  expect((await submitted).postDataJSON()).toEqual({email:'test-auth-navigation@example.test',locale:'en'});
  await expect(form.getByRole('status')).toHaveText('If this email is registered, recovery instructions will be sent.');
  expect(submittedBodies).toEqual([{email:'test-auth-navigation@example.test',locale:'en'}]);
 }finally{
  await page.unroute(forgotRoute);
 }
});
