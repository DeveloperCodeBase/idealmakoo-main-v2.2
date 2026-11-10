import {test,expect} from '@playwright/test';

test('the initially visible research poster is prioritized while reflected and below-fold posters stay lazy',async({page})=>{
  await page.goto('/ar/research/');
  const carousel=page.locator('.content-reference-carousel .gc');
  const initial=carousel.locator('.gc-card.is-active .gc-poster img');
  await expect(initial).toHaveAttribute('loading','eager');
  await expect(initial).toHaveAttribute('fetchpriority','high');
  await expect.poll(()=>initial.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(carousel.locator('img[loading="eager"]')).toHaveCount(1);
  expect(await carousel.locator('.gc-card-reflection img').evaluateAll(images=>images.every(image=>image.getAttribute('loading')==='lazy'))).toBe(true);
  await page.goto('/fa/');
  await expect(page.locator('.gc')).not.toHaveCount(0);
  await expect(page.locator('.gc img[loading="eager"]')).toHaveCount(0);
});
