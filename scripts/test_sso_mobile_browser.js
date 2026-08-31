const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/home/osboxes/bin/google-chrome', args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  let ssoRequests = 0;
  let requestBody = null;
  await page.route('**/api/auth/sso', async (route) => {
    ssoRequests += 1;
    requestBody = route.request().postDataJSON();
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'binding invalid', code: 'SSO_BINDING_INVALID' }) });
  });
  await page.route('**/api/auth/mode', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ live: true, otp: true, telegram: true }) }));
  await page.goto('http://127.0.0.1:4175/?sso_token=SENTINEL_SHOULD_DISAPPEAR&_v=1', { waitUntil: 'networkidle' });
  await page.getByText('Hệ thống đã dừng tự thử lại để tránh vòng lặp').waitFor();
  assert.equal(ssoRequests, 1);
  assert.deepEqual(requestBody, {});
  assert.equal(page.url().includes('sso_token'), false);
  assert.equal(page.url().includes('SENTINEL_SHOULD_DISAPPEAR'), false);
  assert.equal((await page.locator('body').innerText()).includes('SENTINEL_SHOULD_DISAPPEAR'), false);
  await page.screenshot({ path: 'artifacts/sso-binding-mobile-failclosed.png', fullPage: true });
  await browser.close();
  console.log('PASS mobile 390x844: one SSO attempt, URL/token scrubbed, explicit loop-stop message');
})().catch((error) => { console.error(error); process.exitCode = 1; });
