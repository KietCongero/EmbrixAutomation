import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';

test('TC13 - view latest Notify Cancellation to CRM date', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);

    const username = process.env.EMBRIX_USERNAME;
    const password = process.env.EMBRIX_PASSWORD;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing username or password');

    // ============================================================
    // DATE HELPERS
    // ============================================================

    const normalizeDate = (text: string) => {
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (!match) throw new Error(`Could not find date in: ${text}`);
        return match[0];
    };

    const getDaysBetween = (startDate: string, endDate: string) => {
        const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
        const [endYear, endMonth, endDay] = endDate.split('-').map(Number);

        const start = Date.UTC(startYear, startMonth - 1, startDay);
        const end = Date.UTC(endYear, endMonth - 1, endDay);

        return Math.round((end - start) / (1000 * 60 * 60 * 24));
    };

    // ============================================================
    // OPEN ACCOUNT
    // ============================================================

    const openAccount = async () => {
        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const accountSearch = page.locator('.form-group').first().getByRole('textbox');

        await accountSearch.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();

        console.log(`PASS: Account ${accountId} opened`);
    };

    // ============================================================
    // READ FIRST BILLING DUE DATE
    // ============================================================

    const getFirstBillingDueDate = async () => {
        await openAccount();

        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();

        console.log('Looking for first billing invoice...');

        await page.waitForTimeout(2000);
        await page.reload();
        await page.waitForTimeout(2000);

        const billRows = page.getByRole('row').filter({
            has: page.getByRole('cell', { name: 'STAMPED', exact: true }),
        });

        await expect(billRows.last()).toBeVisible();

        const billCount = await billRows.count();

        console.log(`Found ${billCount} STAMPED bill(s)`);

        const firstBillRow = billRows.last();

        const table = firstBillRow.locator('xpath=ancestor::table[1]');
        const headers = table.getByRole('columnheader');
        const headerCount = await headers.count();

        let dueDateIndex = -1;

        for (let i = 0; i < headerCount; i++) {
            const headerText = (await headers.nth(i).innerText()).trim();

            if (headerText === 'Due Date') {
                dueDateIndex = i;
                break;
            }
        }

        if (dueDateIndex === -1) throw new Error('Could not find Due Date column');

        const cells = firstBillRow.getByRole('cell');
        const dueDateText = await cells.nth(dueDateIndex).innerText();
        const firstBillingDueDate = normalizeDate(dueDateText);

        console.log('================================================');
        console.log(`PASS: First Billing Due Date = ${firstBillingDueDate}`);
        console.log('================================================');

        return firstBillingDueDate;
    };

    // ============================================================
    // OPEN COLLECTION
    // ============================================================

    const openCollection = async () => {
        await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
        await page.getByRole('button', { name: 'AR Hub' }).click();
        await page.getByRole('link', { name: 'Collections' }).click();

        const collectionSearch = page.locator('.form-group').first().getByRole('textbox');

        await collectionSearch.fill(accountId);

        console.log(`Searching Collections for account ${accountId}...`);

        await page.getByRole('button', { name: 'Search' }).click();
        await page.waitForTimeout(3000);

        const viewButton = page.getByRole('cell', { name: 'View' }).first();

        await expect(viewButton).toBeVisible();

        await viewButton.click();
        await page.waitForTimeout(3000);

        console.log(`PASS: Collection opened for account ${accountId}`);
    };

    // ============================================================
    // READ LATEST NOTIFY CANCELLATION TO CRM
    // ============================================================

    const getLatestNotifyCancellationDate = async () => {
        await openCollection();

        const actionCells = page.getByRole('cell', {
            name: 'NOTIFY_CANCELLATION_TO_CRM',
            exact: true,
        });

        const actionCount = await actionCells.count();

        console.log(`Found ${actionCount} NOTIFY_CANCELLATION_TO_CRM row(s)`);

        if (actionCount === 0) {
            throw new Error(`Could not find NOTIFY_CANCELLATION_TO_CRM for account ${accountId}`);
        }

        const notifyDates: string[] = [];

        for (let index = 0; index < actionCount; index++) {
            const actionCell = actionCells.nth(index);

            await actionCell.scrollIntoViewIfNeeded();

            const actionRow = actionCell.locator('xpath=ancestor::tr[1]');

            await expect(actionRow).toBeVisible();

            const table = actionRow.locator('xpath=ancestor::table[1]');
            const headers = table.getByRole('columnheader');
            const headerCount = await headers.count();

            let nextActionDateIndex = -1;

            for (let i = 0; i < headerCount; i++) {
                const headerText = (await headers.nth(i).innerText()).trim();

                if (headerText === 'Next Action Date') {
                    nextActionDateIndex = i;
                    break;
                }
            }

            if (nextActionDateIndex === -1) {
                throw new Error('Could not find Next Action Date column');
            }

            const cells = actionRow.getByRole('cell');
            const nextActionDateText = await cells.nth(nextActionDateIndex).innerText();
            const nextActionDate = normalizeDate(nextActionDateText);

            console.log(`NOTIFY_CANCELLATION_TO_CRM row ${index + 1}: ${nextActionDate}`);

            notifyDates.push(nextActionDate);
        }

        notifyDates.sort();

        const latestNotifyDate = notifyDates[notifyDates.length - 1];

        console.log('================================================');
        console.log('PASS: Latest Action = NOTIFY_CANCELLATION_TO_CRM');
        console.log(`PASS: Latest Notify CRM Date = ${latestNotifyDate}`);
        console.log('================================================');

        return latestNotifyDate;
    };

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
    // FIRST BILLING
    // ============================================================

    const firstBillingDueDate = await getFirstBillingDueDate();

    // ============================================================
    // LATEST NOTIFY CRM
    // ============================================================

    const latestNotifyDate = await getLatestNotifyCancellationDate();

    // ============================================================
    // COMPARE
    // ============================================================

    const daysAfterFirstBilling = getDaysBetween(firstBillingDueDate, latestNotifyDate);

    console.log('================================================');
    console.log('TC13 - NOTIFY CANCELLATION VIEW');
    console.log(`Account:                  ${accountId}`);
    console.log(`First Billing Due Date:   ${firstBillingDueDate}`);
    console.log(`Latest Notify CRM Date:   ${latestNotifyDate}`);
    console.log(`Days After First Billing: ${daysAfterFirstBilling} days`);
    console.log('================================================');
});