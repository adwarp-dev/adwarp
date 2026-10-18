import { chromium } from '../../packages/core/node_modules/playwright/index.mjs';
import { AdLibraryBlockedError, isBlockedPage } from '../../packages/core/dist/adLibrary.js';

export async function assertPageAllowed(page, status) {
  const title = await page.title();
  // Read body even on HTTP 200. Challenge pages often use a successful status.
  const body = await page.evaluate(() => document.body?.innerText || '');
  if (isBlockedPage(status, title, body)) throw new AdLibraryBlockedError(0, 'a creative page');
}

export async function collectCreative(id, store, screenshotDir) {
  if (process.platform !== 'linux' || (process.env.ADWARP_CREATIVE_WORKER || process.env.LIADS_CREATIVE_WORKER) !== '1') throw new Error('Creative collection is allowed only in the deployed Linux worker.');
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  let blocked = false;
  let budgetExceeded = false;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 }, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const allowed = url.protocol === 'https:' && (url.hostname === 'www.linkedin.com' || url.hostname === 'static.licdn.com' || url.hostname === 'media.licdn.com');
      // No external landing pages, video downloads, popups, or unbudgeted redirects.
      if (!allowed || request.redirectedFrom() || ['media','font'].includes(request.resourceType()) || blocked || budgetExceeded) return route.abort();
      if (!store.reserveRequest()) { budgetExceeded = true; return route.abort(); }
      return route.continue();
    });
    context.on('response', response => {
      if ([403,429,503].includes(response.status())) {
        blocked = true;
        store.block('A browser request received a block response. Collection disabled pending operator review.');
      }
    });
    const page = await context.newPage();
    context.on('page', other => { if (other !== page) void other.close(); });
    let response;
    try { response = await page.goto(`https://www.linkedin.com/ad-library/detail/${id}`, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch(e) {
      if (/ERR_HTTP_RESPONSE_CODE_FAILURE/.test(String(e)) || blocked) throw new AdLibraryBlockedError(0,'a creative page');
      throw e;
    }
    await assertPageAllowed(page,response?.status());
    await page.locator('[data-creative-type]').first().waitFor({ timeout: 10000 }).catch(async error => {
      await assertPageAllowed(page, response?.status());
      throw error;
    });
    await assertPageAllowed(page,response?.status());
    if (blocked) throw new AdLibraryBlockedError(0,'a creative page');
    if (budgetExceeded) throw new Error('Worker request budget exhausted');
    const copy = await page.evaluate(() => {
      const preview = document.querySelector('[data-creative-type]');
      const text = el => el?.innerText?.trim() || undefined;
      // Do not label advertiser logos or avatars as the creative image.
      const images = Array.from(preview?.querySelectorAll('img') || []).filter(img => {
        const src = img.getAttribute('data-delayed-url') || img.src;
        return !/company-logo|profile-displayphoto/.test(src) && img.getBoundingClientRect().width >= 200;
      });
      const img = images[0];
      return { commentary: text(document.querySelector('.commentary__content')),
        headline: text(preview?.querySelector("a[data-tracking-control-name*='headline'], [class*='headline']")),
        cta: text(preview?.querySelector("a[role='button'], a[class*='cta'], button[class*='cta']")),
        imageUrl: img?.getAttribute('data-delayed-url') || img?.src || undefined };
    });
    await page.locator('[data-creative-type]').first().screenshot({ path: `${screenshotDir}/${id}.png`, timeout: 10000, animations: 'disabled' });
    await assertPageAllowed(page,response?.status());
    if (blocked) throw new AdLibraryBlockedError(0,'a creative page');
    if (budgetExceeded) throw new Error('Worker request budget exhausted');
    return { ...copy, screenshotPath: `/v1/creatives/${id}/screenshot` };
  } finally { await browser.close(); }
}
