import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';

test('TC07 - request invoice grace period', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing EMBRIX_USERNAME or EMBRIX_PASSWORD');

    // ============================================================
    // LOGIN
    // ============================================================

    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    // ============================================================
    // OPEN COLLECTIONS
    // ============================================================

    await page.getByRole('button', { name: 'AR Hub' }).click();
    await page.getByRole('link', { name: 'Collections' }).click();

    console.log('PASS: Collections page opened');

    // ============================================================
    // SEARCH ACCOUNT
    // ============================================================

    const collectionSearch = page.locator('.form-group').first().getByRole('textbox');

    await collectionSearch.fill(accountId);

    console.log(`Searching Collections for account ${accountId}...`);

    // ============================================================
    // WAIT UNTIL COLLECTION INVOICE APPEARS
    // ============================================================

    let collectionFound = false;

    for (let attempt = 1; attempt <= 10; attempt++) {
        console.log(`Collection search attempt ${attempt}/10`);

        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.waitForTimeout(5000);

        const viewButton = page.getByRole('cell', { name: 'View', exact: true }).first();

        if (await viewButton.isVisible().catch(() => false)) {
            console.log(`PASS: Collection invoice found for account ${accountId}`);

            await viewButton.click();

            collectionFound = true;
            break;
        }

        console.log('Collection invoice not found yet. Searching again...');
    }

    expect(collectionFound, `Could not find collection invoice for account ${accountId}`).toBe(true);

    // ============================================================
    // READ NEXT ACTION + NEXT ACTION DATE
    // ============================================================

    const collectionRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'COLLECTION', exact: true }) }).first();

    await expect(collectionRow).toBeVisible();

    const table = collectionRow.locator('xpath=ancestor::table[1]');
    const headers = table.getByRole('columnheader');

    let nextActionIndex = -1;
    let nextActionDateIndex = -1;

    for (let i = 0; i < await headers.count(); i++) {
        const header = (await headers.nth(i).innerText()).trim();

        if (header === 'Next Action') nextActionIndex = i;
        if (header === 'Next Action Date') nextActionDateIndex = i;
    }

    if (nextActionDateIndex === -1) throw new Error('Could not find Next Action Date column');

    const cells = collectionRow.getByRole('cell');

    const nextAction = nextActionIndex >= 0 ? (await cells.nth(nextActionIndex).innerText()).trim() : 'UNKNOWN';
    const nextActionDateText = (await cells.nth(nextActionDateIndex).innerText()).trim();
    const dateMatch = nextActionDateText.match(/\d{4}-\d{2}-\d{2}/);

    if (!dateMatch) throw new Error(`Could not read Next Action Date: ${nextActionDateText}`);

    const nextActionDate = dateMatch[0];

    console.log(`Current Next Action: ${nextAction}`);
    console.log(`Current Next Action Date: ${nextActionDate}`);

    // ============================================================
    // CALCULATE GRACE PERIOD THROUGH END OF MONTH
    // ============================================================

    const [year, month, day] = nextActionDate.split('-').map(Number);
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    const gracePeriodDays = lastDayOfMonth - day;

    if (gracePeriodDays < 0) throw new Error(`Invalid grace period calculation for ${nextActionDate}`);

    const gracePeriodEndDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

    console.log('================================================');
    console.log(`Next Action Date: ${nextActionDate}`);
    console.log(`End Of Month: ${gracePeriodEndDate}`);
    console.log(`Grace Period Days: ${gracePeriodDays}`);
    console.log('================================================');

    // ============================================================
    // SELECT CORRECT COLLECTION UNIT ROW
    // ============================================================

    const collectionUnitRow = page.locator('.col-md-12 > #scrollableDiv > .table > tbody > tr').filter({ hasText: nextActionDate }).first();

    await expect(collectionUnitRow).toBeVisible();

    const rowCheckbox = collectionUnitRow.locator('.custom-control');

    await expect(rowCheckbox).toBeVisible();
    await rowCheckbox.click();

    console.log(`PASS: Collection unit selected for ${nextActionDate}`);

    // ============================================================
    // SELECT GRACE PERIOD REQUESTED
    // ============================================================

    const statusSelect = page.locator('.form-group.select-group.col-md-4').filter({ hasText: 'Collection Unit Status' });

    await expect(statusSelect).toBeVisible();
    await statusSelect.click();

    const gracePeriodOption = page.locator('div[id^="react-select-"][id*="-option-"]').filter({ hasText: /^GRACE_PERIOD_REQUESTED$/ });

    await expect(gracePeriodOption).toBeVisible();
    await gracePeriodOption.click();

    console.log('PASS: GRACE_PERIOD_REQUESTED selected');

    // ============================================================
    // SET GRACE PERIOD
    // ============================================================

    await page.getByText('Grace Period', { exact: true }).click();

    const plusButton = page.locator('.plus-number');

    await expect(plusButton).toBeVisible();

    for (let i = 0; i < gracePeriodDays; i++) {
        await plusButton.click();
    }

    console.log(`PASS: Grace period increased ${gracePeriodDays} day(s)`);

    // ============================================================
    // COMMENT
    // ============================================================

    const commentBox = page.locator('textarea:visible').first();

    await expect(commentBox).toBeVisible();
    await commentBox.fill(`Grace period requested through ${gracePeriodEndDate}`);

    // ============================================================
    // APPLY
    // ============================================================

    await page.getByRole('button', { name: 'Apply' }).click();

    console.log('================================================');
    console.log('PASS: GRACE PERIOD REQUEST APPLIED');
    console.log(`Account: ${accountId}`);
    console.log(`Original Next Action: ${nextAction}`);
    console.log(`Original Next Action Date: ${nextActionDate}`);
    console.log(`Grace Period End Date: ${gracePeriodEndDate}`);
    console.log(`Grace Period Days: ${gracePeriodDays}`);
    console.log('================================================');
});