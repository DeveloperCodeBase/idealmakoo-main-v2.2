import {test,expect,type Page} from '@playwright/test';

test.use({viewport:{width:412,height:823},deviceScaleFactor:1.75,isMobile:true,hasTouch:true});

async function openResearch(page:Page){
  await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname.replace(/\/$/,'')==='/api/v1/auth/session'),
    page.goto('/ar/research/'),
  ]);
  const carousel=page.locator('.content-reference-carousel .gc');
  await expect(carousel.locator('.gc-card.is-active .gc-poster img')).toBeVisible();
  return carousel;
}

test('native fullscreen retains synchronized controls through portal changes and opens details inside the fullscreen element',async({page})=>{
  const carousel=await openResearch(page);
  // The preceding article link must not prevent the requested initial Close focus.
  await carousel.locator('.gc-card.is-active .gc-card-button').click();
  const detail=page.locator('.gc-detail-dialog[open]');
  await expect(detail.locator('.gc-external')).toBeVisible();
  await expect(detail.locator('.gc-close')).toBeFocused();
  await detail.locator('.gc-close').click();
  await expect(page.locator('.gc-detail-dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>document.fullscreenEnabled)).toBe(true);
  await carousel.locator('.gc-fullscreen').click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===document.querySelector('.content-reference-carousel .gc'))).toBe(true);
  await expect(carousel).toHaveAttribute('data-expanded-view','true');
  await expect(carousel.locator('.gc-immersive-close')).toBeVisible();

  await carousel.locator('.gc-card.is-active .gc-card-button').click();
  await expect(detail).toBeVisible();
  await expect(detail.locator('.gc-close')).toBeFocused();
  expect(await detail.evaluate(dialog=>document.fullscreenElement?.contains(dialog))).toBe(true);
  await expect(detail.locator('.gc-detail-body img').first()).toBeVisible();
  await detail.locator('.gc-close').click();
  await expect(page.locator('.gc-detail-dialog')).toHaveCount(0);

  await carousel.locator('.gc-immersive-close').click();
  await expect.poll(()=>page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
  await expect(carousel).toHaveAttribute('data-expanded-view','false');
  await expect(carousel.locator('.gc-immersive-close')).toHaveCount(0);
});

test('a browser-enforced fullscreen denial keeps the accessible dialog fallback and normal exit usable',async({page})=>{
  // A stricter document policy exercises the browser's real rejection path;
  // the platform API and application handlers remain unmodified.
  await page.route('**/ar/research/',async route=>{
    const response=await route.fetch();
    const headers=response.headers();
    const other=(headers['permissions-policy']||'').split(',').map(value=>value.trim()).filter(value=>value&&!/^fullscreen\s*=/.test(value));
    await route.fulfill({response,headers:{...headers,'permissions-policy':[...other,'fullscreen=()'].join(', ')}});
  });
  const carousel=await openResearch(page);
  expect(await page.evaluate(()=>document.fullscreenEnabled)).toBe(false);
  await carousel.locator('.gc-fullscreen').click();
  const fallback=page.locator('.gc-fullscreen-dialog[open]');
  await expect(fallback).toBeVisible();
  await expect(fallback.locator('.gc')).toHaveAttribute('data-expanded-view','true');
  await expect(fallback.locator('.gc-immersive-close')).toBeVisible();
  expect(await page.evaluate(()=>document.fullscreenElement)).toBe(null);

  await fallback.locator('.gc-card.is-active .gc-card-button').click();
  const detail=page.locator('.gc-detail-dialog[open]');
  await expect(detail).toBeVisible();
  await expect(detail.locator('.gc-close')).toBeFocused();
  await detail.locator('.gc-close').click();
  await expect(page.locator('.gc-detail-dialog')).toHaveCount(0);
  await fallback.locator('.gc-immersive-close').click();
  await expect(page.locator('.gc-fullscreen-dialog')).toHaveCount(0);
  await expect(carousel).toHaveAttribute('data-expanded-view','false');
  await expect(carousel.locator('.gc-fullscreen')).toBeFocused();
});
