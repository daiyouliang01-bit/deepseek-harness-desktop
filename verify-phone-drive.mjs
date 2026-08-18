import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/litong/Documents/DeepSeekHarnessDesktop/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/index.js');

const url = process.env.TARGET_URL || 'https://dsh.dpharness.xyz/';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => errors.push('FAIL ' + r.url().slice(0, 120)));
page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url().slice(0, 120)); });

await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(5000);

// Click "Continue" to get past onboarding if present
const continueBtn = page.getByText('Continue', { exact: true }).first();
try {
  if (await continueBtn.isVisible({ timeout: 3000 })) {
    await continueBtn.click();
    await page.waitForTimeout(4000);
  }
} catch { /* onboarding may already be dismissed */ }

// Screenshot after onboarding
await page.screenshot({ path: '/tmp/phone-after-onboard.png', fullPage: false });
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 1500);
console.log('BODY_AFTER:');
console.log(bodyText);

// Try to find clickable session entries
const sessionCandidates = await page.locator('[class*="session"], [data-session-id], li, a').count();
console.log('CANDIDATE_NODES:', sessionCandidates);

console.log('ERRORS:', errors.length);
errors.slice(0, 12).forEach((e) => console.log('  >', e.slice(0, 200)));

await browser.close();