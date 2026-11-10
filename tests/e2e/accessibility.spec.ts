import AxeBuilder from '@axe-core/playwright';
import {expect,test} from '@playwright/test';

// A bounded automated WCAG A/AA regression gate. This does not replace manual
// assistive-technology, keyboard or complete application accessibility review.
for(const locale of ['fa','en'] as const)for(const theme of ['dark','light'] as const)for(const route of ['','auth/login','contact'] as const){
  test(`public accessibility: ${locale} ${theme} ${route||'home'}`,async({page},testInfo)=>{
    // The full home accessibility scan can use software rendering in native CI.
    test.setTimeout(route?90_000:180_000);
    await page.addInitScript(value=>{localStorage.setItem('idealmakoo.theme',value);},theme);
    const response=await page.goto(`/${locale}/${route?route+'/':''}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang',locale);
    await expect(page.locator('html')).toHaveAttribute('dir',locale==='fa'?'rtl':'ltr');
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await expect(page.getByRole('heading',{level:1}).first()).toBeVisible();
    await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
    const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
    await testInfo.attach('axe-results.json',{body:JSON.stringify({url:page.url(),locale,theme,violations:report.violations,incomplete:report.incomplete,passes:report.passes.map(rule=>rule.id)},null,2),contentType:'application/json'});
    // Playwright retains a screenshot automatically on failure. Full-page WebGL
    // captures belong to visual QA and must not delay the actual Axe assertion.
    expect(report.violations.map(rule=>({id:rule.id,impact:rule.impact,help:rule.help,helpUrl:rule.helpUrl,nodes:rule.nodes.map(node=>({target:node.target,failureSummary:node.failureSummary}))}))).toEqual([]);
  });
}
