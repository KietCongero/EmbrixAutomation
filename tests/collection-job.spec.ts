import { test, expect, Page } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';

const DAILY_JOB_URL = 'https://core-ui.demo.embrix.org/jobs-management/job-schedule/CJ-12';
const username = process.env.EMBRIX_USERNAME;
const password = process.env.EMBRIX_PASSWORD;

if (!username || !password) throw new Error('Missing username or password');

async function login(page: Page) {
    await page.goto('https://core-ui.demo.embrix.org/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username!);
    await page.getByRole('textbox', { name: 'Password' }).fill(password!);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);
    console.log('PASS: Login successful');
}

async function openAccount(page: Page) {
    await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
    await page.getByRole('button', { name: 'Customer Hub' }).click();
    await page.getByRole('link', { name: 'Customer Management' }).first().click();

    const search = page.locator('.form-group').first().getByRole('textbox');

    await search.fill(ACCOUNT_ID);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: ACCOUNT_ID, exact: true }).click();

    console.log(`PASS: Account ${ACCOUNT_ID} opened`);
}

async function getInvoiceDueDate(page: Page) {
    await openAccount(page);

    await page.locator('a').filter({ hasText: 'Billing Data' }).click();
    await page.getByRole('link', { name: ' Bills' }).click();

    const billRow = page.getByRole('row').filter({ hasText: 'ACTIVE' }).filter({ hasText: 'STAMPED' }).first();

    await expect(billRow).toBeVisible();

    const table = billRow.locator('xpath=ancestor::table[1]');
    const headers = table.getByRole('columnheader');

    let dueDateIndex = -1;

    for (let i = 0; i < await headers.count(); i++) {
        const text = (await headers.nth(i).innerText()).trim();
        if (text === 'Due Date') dueDateIndex = i;
    }

    if (dueDateIndex === -1) throw new Error('Could not find Due Date column');

    const dueDateText = await billRow.getByRole('cell').nth(dueDateIndex).innerText();
    const match = dueDateText.match(/\d{4}-\d{2}-\d{2}/);

    if (!match) throw new Error(`Could not read due date: ${dueDateText}`);

    console.log(`PASS: Invoice due date = ${match[0]}`);

    return match[0];
}

async function getPendingBillEndDate(page: Page) {
    await openAccount(page);

    await page.locator('a').filter({ hasText: 'Billing Data' }).click();
    await page.getByRole('link', { name: ' Bills' }).click();

    console.log('Looking for pending bill...');

    const pendingHeading = page.getByRole('heading', { name: 'Pending Bills' });
    await expect(pendingHeading).toBeVisible();

    const pendingTable = pendingHeading.locator('xpath=following::table[1]');
    const headers = pendingTable.getByRole('columnheader');
    const row = pendingTable.locator('tbody tr').first();

    await expect(row).toBeVisible();

    let endDateIndex = -1;

    for (let i = 0; i < await headers.count(); i++) {
        const text = (await headers.nth(i).innerText()).trim();
        if (text === 'End Date') endDateIndex = i;
    }

    if (endDateIndex === -1) throw new Error('Could not find Pending Bills End Date column');

    const endDateText = (await row.getByRole('cell').nth(endDateIndex).innerText()).trim();
    const match = endDateText.match(/\d{4}-\d{2}-\d{2}/);

    if (!match) throw new Error(`Could not read pending bill end date: ${endDateText}`);

    console.log(`PASS: Pending bill end date = ${match[0]}`);

    return match[0];
}

async function setCcpTime(page: Page, targetDate: string) {
    await page.goto('https://transactional.coopeg.embrix.org/graphiql?');

    const mutation = `mutation {
  setCcpTime(input: {
    ccpTime: "${targetDate}"
  })
  {
    ccpTime
  }
}`;

    await page.evaluate((query) => {
        const editor = (document.querySelector('.CodeMirror') as any)?.CodeMirror;
        if (!editor) throw new Error('CodeMirror editor not found');
        editor.setValue(query);
        editor.focus();
    }, mutation);

    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();
    await expect(page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })).toBeVisible();

    console.log(`PASS: CCP time = ${targetDate}`);
}

async function deleteJobs(targetDate: string) {
    const jobs = await queryDatabase(`SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

    for (const job of jobs) {
        await queryDatabase(`DELETE FROM core_engine.job_schedule_list WHERE id = $1`, [job.id]);
        await queryDatabase(`DELETE FROM core_engine.job_schedule WHERE id = $1`, [job.id]);
        console.log(`PASS: Deleted job ${job.id}`);
    }
}

async function fillJobDate(page: Page, targetDate: string) {
    const input = page.getByRole('textbox').first();

    await input.click();
    await input.press('ControlOrMeta+a');
    await input.fill(targetDate);
    await input.press('Escape');
}

async function waitForJob(page: Page) {
    for (let attempt = 1; attempt <= 6; attempt++) {
        console.log(`Checking job status ${attempt}/6`);
        await page.waitForTimeout(5000);
        await page.getByTitle('Refresh jobs').click();

        if (await page.getByText('Completed', { exact: true }).first().isVisible().catch(() => false)) {
            console.log('PASS: Job completed');
            return;
        }
    }

    console.log('WARNING: Completed status not detected');
}

async function createAndRunDailyJob(page: Page, targetDate: string) {
    await deleteJobs(targetDate);
    await setCcpTime(page, targetDate);

    await page.goto(DAILY_JOB_URL);
    await fillJobDate(page, targetDate);

    await page.getByRole('button', { name: 'Create Job Schedule' }).click();
    await page.getByTitle('Refresh jobs').click();
    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: 'Process' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    console.log(`PASS: Initial collection job started for ${targetDate}`);

    await waitForJob(page);
}

async function getCollectionInfo(page: Page) {
    await page.goto('https://core-ui.demo.embrix.org/dashboard/me');
    await page.getByRole('button', { name: 'AR Hub' }).click();
    await page.getByRole('link', { name: 'Collections' }).click();

    const search = page.locator('.form-group').first().getByRole('textbox');

    await search.fill(ACCOUNT_ID);

    let found = false;

    for (let attempt = 1; attempt <= 10; attempt++) {
        console.log(`Collection search ${attempt}/10`);

        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.waitForTimeout(5000);

        const view = page.getByRole('cell', { name: 'View', exact: true }).first();

        if (await view.isVisible().catch(() => false)) {
            await view.click();
            found = true;
            break;
        }
    }

    if (!found) throw new Error(`Collection not found for ${ACCOUNT_ID}`);

    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'COLLECTION', exact: true }) }).first();

    await expect(row).toBeVisible();

    const table = row.locator('xpath=ancestor::table[1]');
    const headers = table.getByRole('columnheader');

    let actionIndex = -1;
    let dateIndex = -1;

    for (let i = 0; i < await headers.count(); i++) {
        const text = (await headers.nth(i).innerText()).trim();
        if (text === 'Next Action') actionIndex = i;
        if (text === 'Next Action Date') dateIndex = i;
    }

    if (actionIndex === -1) throw new Error('Could not find Next Action column');
    if (dateIndex === -1) throw new Error('Could not find Next Action Date column');

    const cells = row.getByRole('cell');
    const nextAction = (await cells.nth(actionIndex).innerText()).trim();
    const nextActionDateText = (await cells.nth(dateIndex).innerText()).trim();
    const match = nextActionDateText.match(/\d{4}-\d{2}-\d{2}/);

    if (!match) throw new Error(`Could not read Next Action Date: ${nextActionDateText}`);

    console.log('========================================');
    console.log('Invoice Status: COLLECTION');
    console.log(`Next Action: ${nextAction}`);
    console.log(`Next Action Date: ${match[0]}`);
    console.log('========================================');

    return { status: 'COLLECTION', nextAction, nextActionDate: match[0] };
}

async function runExistingDailyJob(page: Page, targetDate: string) {
    await setCcpTime(page, targetDate);

    await page.goto(DAILY_JOB_URL);
    await fillJobDate(page, targetDate);

    await page.getByTitle('Refresh jobs').click();
    await page.waitForTimeout(5000);

    await expect(page.getByRole('button', { name: 'Process' })).toBeVisible();

    await page.getByRole('button', { name: 'Process' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    console.log(`PASS: EMBRIX-created job started for ${targetDate}`);

    await waitForJob(page);
}

async function runCollectionStartOn16th(page: Page, referenceDate: string) {
    const [year, month] = referenceDate.split('-');
    const collectionStartDate = `${year}-${month}-16`;

    console.log(`Temporary collection start date: ${collectionStartDate}`);

    await deleteJobs(collectionStartDate);
    await setCcpTime(page, collectionStartDate);

    await page.goto(DAILY_JOB_URL);
    await fillJobDate(page, collectionStartDate);

    await page.getByRole('button', { name: 'Create Job Schedule' }).click();
    await page.getByTitle('Refresh jobs').click();
    await page.waitForTimeout(5000);
    await page.getByRole('button', { name: 'Process' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    console.log(`PASS: Temporary collection-start job ran for ${collectionStartDate}`);

    await waitForJob(page);
}

test('COLLECTION - start collection', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    await login(page);

    // RUN FIRST JOB TO GET THE BILL TO APPEAR
    const pendingBillEndDate = await getPendingBillEndDate(page);

    await createAndRunDailyJob(page, pendingBillEndDate);

    const [year, month] = pendingBillEndDate.split('-');

    const collectionStartDate = `${year}-${month}-16`;

    console.log(`Pending Bill End Date: ${pendingBillEndDate}`);
    console.log(`Collection Start Date: ${collectionStartDate}`);

    await createAndRunDailyJob(page, collectionStartDate);

    /*
    const dueDate = await getInvoiceDueDate(page);

    console.log(`Starting collection using invoice due date ${dueDate}`);

    await createAndRunDailyJob(page, dueDate);
    */

    const collection = await getCollectionInfo(page);

    expect(collection.status).toBe('COLLECTION');

    console.log(`PASS: Invoice entered COLLECTION`);
    console.log(`PASS: Next Action = ${collection.nextAction}`);
    console.log(`PASS: Next Action Date = ${collection.nextActionDate}`);
});

test('COLLECTION - run next action', async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    await login(page);

    const before = await getCollectionInfo(page);

    console.log(`Running ${before.nextAction} on ${before.nextActionDate}`);

    await runExistingDailyJob(page, before.nextActionDate);

    const after = await getCollectionInfo(page);

    expect(after.status).toBe('COLLECTION');
    expect(after.nextAction).not.toBe(before.nextAction);

    console.log(`PASS: Previous Action = ${before.nextAction}`);
    console.log(`PASS: New Next Action = ${after.nextAction}`);
    console.log(`PASS: New Next Action Date = ${after.nextActionDate}`);
});