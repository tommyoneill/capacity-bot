// @ts-check
const { test, expect } = require('@playwright/test');

const SHOTS = 'screenshots';

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // expose for assertions
  page.__errors = errors;
  await page.goto('/index.html');
  await page.waitForFunction(() => document.querySelectorAll('#gridBody .prow').length > 0);
});

test('person grid renders with no runtime errors', async ({ page }) => {
  await expect(page.locator('#gridBody .prow[data-pid]')).toHaveCount(16);
  await expect(page.locator('#gridHead .col-head')).toHaveCount(26);
  await expect(page.locator('#gridTotals .tcell')).toHaveCount(26);
  await expect(page.locator('.col-head.now')).toHaveCount(1);
  expect(page.__errors).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/01-person-week.png`, fullPage: false });
});

test('range zoom re-aggregates columns', async ({ page }) => {
  const counts = {};
  for (const r of ['month', 'quarter', 'year', 'week']) {
    await page.click(`#rangeSeg button[data-r="${r}"]`);
    counts[r] = await page.locator('#gridHead .col-head').count();
  }
  expect(counts.month).toBe(7);
  expect(counts.quarter).toBe(3);
  expect(counts.year).toBe(1);
  expect(counts.week).toBe(26);
});

test('percent toggle changes cell formatting', async ({ page }) => {
  await page.click('#unitSeg button[data-u="percent"]');
  const txt = await page.locator('#gridBody .cell .v').first().innerText();
  expect(txt).toMatch(/%|·/);
});

test('expanding a row reveals project lanes', async ({ page }) => {
  await page.locator('.prow .chev').first().click();
  await expect(page.locator('.lanes .lane').first()).toBeVisible();
  expect(await page.locator('.lanes .lane').count()).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/02-person-expanded.png` });
});

test('inline editing a lane cell updates the grid', async ({ page }) => {
  await page.locator('.prow .chev').first().click();
  const cell = page.locator('.lcell[data-proj]').first();
  await cell.click();
  const input = cell.locator('input');
  await expect(input).toBeVisible();
  await input.fill('18');
  await input.press('Enter');
  await expect(page.locator('.lcell[data-proj] input')).toHaveCount(0);
});

test('person detail panel opens with all sections', async ({ page }) => {
  await page.locator('.prow .nmeta').first().click();
  await expect(page.locator('#panel')).toHaveClass(/on/);
  await expect(page.locator('#panel h2')).toBeVisible();
  await expect(page.locator('#panel .sec')).toHaveCount(4);
  await expect(page.locator('#panel .pbar .seg-b').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-person-panel.png` });
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel')).not.toHaveClass(/on/);
});

test('team view shows teams that expand to member lanes', async ({ page }) => {
  await page.click('#viewSeg button[data-v="team"]');
  await expect(page.locator('#gridBody .prow[data-tid]')).toHaveCount(4);
  await expect(page.locator('#gridHead .col-head')).toHaveCount(26);
  await expect(page.locator('.corner-label')).toHaveText('Team');
  expect(page.__errors).toEqual([]);
  // expand first team -> member lanes appear and clicking one opens that person
  await page.locator('.prow[data-tid] .chev').first().click();
  await expect(page.locator('.lanes .lane .lname[data-go]').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-team-week.png` });
  await page.locator('.lanes .lane .lname[data-go]').first().click();
  await expect(page.locator('#panel')).toHaveClass(/on/);
  await page.keyboard.press('Escape');
});

test('team detail panel opens with members and project mix', async ({ page }) => {
  await page.click('#viewSeg button[data-v="team"]');
  await page.locator('.prow[data-tid] .nmeta').first().click();
  await expect(page.locator('#panel')).toHaveClass(/on/);
  await expect(page.locator('#panel .sec')).toHaveCount(4);
  expect(await page.locator('#panel .alloc[data-go]').count()).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/07-team-panel.png` });
});

test('every person belongs to exactly one of four teams', async ({ page }) => {
  const teams = await page.evaluate(() => {
    const ids = window.PEOPLE ? PEOPLE.map(p => p.team) : [];
    return ids;
  });
  // PEOPLE isn't global; assert via the rendered team rollup instead
  await page.click('#viewSeg button[data-v="team"]');
  const counts = await page.$$eval('.prow[data-tid] .pill', els => els.map(e => e.textContent));
  const total = counts.reduce((s, t) => s + parseInt(t), 0);
  expect(total).toBe(16);
});

test('add person creates a new row', async ({ page }) => {
  const before = await page.locator('#gridBody .prow[data-pid]').count();
  await page.click('#addPersonBtn');
  await expect(page.locator('#panel')).toHaveClass(/on/);
  await page.fill('#fName', 'Alex Rivera');
  await page.selectOption('#fRole', 'qa');
  await page.selectOption('#fTeam', 't2');
  await page.click('#fPresets button[data-h="30"]');
  await expect(page.locator('#fReadout')).toContainText('30h');
  await expect(page.locator('#fReadout')).toContainText('23h'); // 30 - 7 overhead
  await page.click('#fSave');
  await expect(page.locator('#panel')).not.toHaveClass(/on/);
  await expect(page.locator('#gridBody .prow[data-pid]')).toHaveCount(before + 1);
  await expect(page.locator('#teamCount')).toHaveText(String(before + 1));
  await page.screenshot({ path: `${SHOTS}/08-add-person.png` });
});

test('add person requires a name', async ({ page }) => {
  await page.click('#addPersonBtn');
  await page.click('#fSave');
  await expect(page.locator('#fNameField')).toHaveClass(/invalid/);
  await expect(page.locator('#panel')).toHaveClass(/on/); // still open
});

test('editing weekly hours lowers plannable and pushes utilization up', async ({ page }) => {
  // open first person, read their util %, then cut hours to 20
  await page.locator('.prow .nmeta').first().click();
  const before = parseInt(await page.locator('#panel .ph-stats .st').nth(2).locator('.num').innerText());
  await page.click('#editPersonBtn');
  await page.fill('#fHours', '20');
  await expect(page.locator('#fReadout')).toContainText('20h');
  await page.click('#fSave');
  // back on detail panel: plannable stat should now reflect 20 - overhead
  const plannable = parseInt(await page.locator('#panel .ph-stats .st').nth(1).locator('.num').innerText());
  expect(plannable).toBeLessThan(20);
  const after = parseInt(await page.locator('#panel .ph-stats .st').nth(2).locator('.num').innerText());
  expect(after).toBeGreaterThan(before); // same committed work / less plannable => higher %
  await page.screenshot({ path: `${SHOTS}/09-edit-hours.png` });
});

test('delete person removes the row after confirm', async ({ page }) => {
  const before = await page.locator('#gridBody .prow[data-pid]').count();
  await page.locator('.prow .nmeta').first().click();
  await page.click('#editPersonBtn');
  await page.click('#fDelete');
  await expect(page.locator('#fDelYes')).toBeVisible();
  await page.click('#fDelYes');
  await expect(page.locator('#panel')).not.toHaveClass(/on/);
  await expect(page.locator('#gridBody .prow[data-pid]')).toHaveCount(before - 1);
});

test('role view shows disciplines and triple cells', async ({ page }) => {
  await page.click('#viewSeg button[data-v="role"]');
  await expect(page.locator('#gridBody .prow[data-rid]')).toHaveCount(5);
  await expect(page.locator('.cell.role').first().locator('.r1')).toBeVisible();
  await expect(page.locator('.cell.role').first().locator('.r3')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-role-week.png` });
});

test('role detail panel opens with demand rows', async ({ page }) => {
  await page.click('#viewSeg button[data-v="role"]');
  await page.locator('.prow[data-rid]').first().click();
  await expect(page.locator('#panel')).toHaveClass(/on/);
  expect(await page.locator('#panel .demand-row').count()).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/05-role-panel.png` });
});
