import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/litong/Documents/DeepSeekHarnessDesktop/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.js');

const url = process.env.TARGET_URL || 'https://dsh.dpharness.xyz/';
const errors = [];
const failed = [];
let wsSeen = [];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => failed.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(r.status() + ' ' + r.url());
  if (r.url().startsWith('ws')) wsSeen.push(r.status() + ' ' + r.url());
});

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
} catch (e) {
  errors.push('GOTO: ' + e.message);
}
// give the app a moment to hydrate and open realtime
await page.waitForTimeout(6000);

const boot = await page.evaluate(() => !!window.__DSH_BOOT__);
const bodyText = (await page.evaluate(() => document.body ? document.body.innerText : '')).slice(0, 1200);
const title = await page.title();

await page.screenshot({ path: '/tmp/phone-full.png', fullPage: false });

console.log('TITLE:', title);
console.log('BOOT_MARKER:', boot);
console.log('BODY_TEXT_START:');
console.log(bodyText);
console.log('CONSOLE_ERRORS:', errors.length);
errors.slice(0, 15).forEach((e) => console.log('  ERR:', e.slice(0, 300)));
console.log('FAILED_REQUESTS:', failed.length);
failed.slice(0, 15).forEach((f) => console.log('  FAIL:', f.slice(0, 300)));
console.log('WS_RESPONSES:', wsSeen.length);
wsSeen.slice(0, 5).forEach((w) => console.log('  WS:', w));

await browser.close();