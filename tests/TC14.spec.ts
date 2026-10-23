import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';
import { ACCOUNT_ID } from '../test-data/testIds';
import { env } from '../config/environments';

test('TC14 - intercompany billing, credit notes and work order activity', async ({ page }) => {
    test.setTimeout(30 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const accountId = ACCOUNT_ID;

    if (!username || !password) throw new Error('Missing username or password');

    const moneyToCents = (text: string) => {
        const value = Number(text.replace(/,/g, '').replace(/[^\d.-]/g, ''));
        if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${text}`);
        return Math.round(value * 100);
    };

    const openAccount = async () => {
        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Customer Hub' }).click();
        await page.getByRole('link', { name: 'Customer Management' }).first().click();

        const accountSearch = page.locator('.form-group').first().getByRole('textbox');
        await accountSearch.fill(accountId);
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        await page.getByRole('link', { name: accountId, exact: true }).click();
    };

    const openBills = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Billing Data' }).click();
        await page.getByRole('link', { name: ' Bills' }).click();
    };

    const getNextPendingBill = async () => {
        await openBills();

        const pendingBillRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'PENDING', exact: true }) }).first();
        await expect(pendingBillRow).toBeVisible();

        const dateCells = pendingBillRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });
        await expect(dateCells.nth(0)).toBeVisible();
        await expect(dateCells.nth(1)).toBeVisible();

        const startDate = (await dateCells.nth(0).innerText()).trim();
        const endDate = (await dateCells.nth(1).innerText()).trim();
        console.log(`PASS: Pending bill ${startDate} -> ${endDate}`);
        return { startDate, endDate, jobDate: endDate };
    };

    const cleanJobs = async (targetDate: string) => {
        const jobs = await queryDatabase('SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1', [targetDate]);
        console.log(`Cleaning ${jobs.length} job(s) for ${targetDate}...`);

        for (const job of jobs) {
            await queryDatabase('DELETE FROM core_engine.job_schedule_list WHERE id = $1', [job.id]);
            await queryDatabase('DELETE FROM core_engine.job_schedule WHERE id = $1', [job.id]);
            console.log(`PASS: Deleted job ${job.id}`);
        }

        const remainingJobs = await queryDatabase('SELECT * FROM core_engine.job_schedule WHERE scheduledate = $1', [targetDate]);
        expect(remainingJobs.length, `Jobs still exist for ${targetDate}`).toBe(0);
    };

    const setCcpTime = async (targetDate: string) => {
        await page.goto(env.graphiqlUrl);

        const mutation = `mutation {
  setCcpTime(input: {
    ccpTime: "${targetDate}"
  })
  {
    ccpTime
  }
}`;

        await page.evaluate((query) => {
            const editorElement = document.querySelector('.CodeMirror');
            const codeMirror = (editorElement as any)?.CodeMirror;
            if (!codeMirror) throw new Error('CodeMirror editor not found');
            codeMirror.setValue(query);
            codeMirror.focus();
        }, mutation);

        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();
        await expect(page.locator('pre').filter({ hasText: `"ccpTime": "${targetDate}"` })).toBeVisible();
        console.log(`PASS: CCP time = ${targetDate}`);
    };

    const runDailyJob = async (targetDate: string) => {
        await page.goto('/dashboard/me');
        await page.getByRole('button', { name: 'Operations Hub' }).click();
        await page.getByRole('link', { name: 'Jobs Management' }).click();
        await page.locator('#sidebarnav a').filter({ hasText: 'Jobs Management' }).click();
        await page.getByRole('link', { name: ' DAILY' }).click();

        const dateInput = page.getByRole('textbox').first();
        await dateInput.click();
        await dateInput.press('ControlOrMeta+a');
        await dateInput.fill(targetDate);
        await dateInput.press('Escape');

        await page.getByRole('button', { name: 'Create Job Schedule' }).click();
        await page.getByTitle('Refresh jobs').click();
        await page.waitForTimeout(2000);
        await page.getByRole('button', { name: 'Process' }).click();
        await page.getByRole('button', { name: 'Yes' }).click();
        console.log(`PASS: Started DAILY billing job for ${targetDate}`);

        await page.waitForTimeout(15000);
        let invoiceStatus = 'UNKNOWN';

        for (let attempt = 1; attempt <= 20; attempt++) {
            console.log(`Checking INVOICE_CHECK ${targetDate}: ${attempt}/20`);
            await page.getByTitle('Refresh jobs').click();
            await page.waitForTimeout(15000);

            const invoiceCheck = page.getByRole('heading', { name: 'INVOICE_CHECK' });
            if (!(await invoiceCheck.isVisible().catch(() => false))) continue;

            if (await page.getByTitle('Status: COMPLETED').isVisible().catch(() => false)) {
                invoiceStatus = 'COMPLETED';
                break;
            }

            if (await page.getByTitle('Status: ERROR').isVisible().catch(() => false)) {
                invoiceStatus = 'ERROR';
                break;
            }
        }

        if (invoiceStatus === 'ERROR') {
            console.log(`WARNING: INVOICE_CHECK reached ERROR for ${targetDate}`);
        } else if (invoiceStatus === 'COMPLETED') {
            console.log(`PASS: INVOICE_CHECK reached COMPLETED for ${targetDate}`);
        } else {
            console.log(`WARNING: INVOICE_CHECK did not reach COMPLETED or ERROR after 20 attempts for ${targetDate}`);
            console.log('Continuing to bill verification...');
        }

        console.log(`Final INVOICE_CHECK status: ${invoiceStatus}`);
    };


    const getCreditNotes = async () => {
        await page.goto(`/customers/${accountId}/credit-notes`);

        const table = page.getByRole('columnheader', { name: 'Invoice Id' }).locator('xpath=ancestor::table[1]');
        await expect(table).toBeVisible();

        const headers = (await table.getByRole('columnheader').allInnerTexts()).map(text => text.trim());
        const invoiceIndex = headers.indexOf('Invoice Id');
        const totalIndex = headers.indexOf('Total');
        const statusIndex = headers.indexOf('Status');

        const rows = table.locator('tbody tr');
        const result: { key: string; invoiceId: string; amountCents: number; status: string }[] = [];

        for (let i = 0; i < await rows.count(); i++) {
            const cells = (await rows.nth(i).getByRole('cell').allInnerTexts()).map(text => text.trim());

            if (!cells.includes('CREDIT_NOTE')) continue;

            result.push({
                key: cells.join('|'),
                invoiceId: cells[invoiceIndex],
                amountCents: moneyToCents(cells[totalIndex]),
                status: cells[statusIndex]
            });
        }

        console.log('Credit notes:', result);
        return result;
    };


    const verifyClosedBill = async (startDate: string, endDate: string) => {
        await openBills();
        await page.waitForTimeout(2000);
        await page.reload();

        const billRow = page.getByRole('row')
            .filter({ hasText: startDate })
            .filter({ hasText: endDate })
            .filter({ has: page.getByRole('cell', { name: 'CLOSED', exact: true }) })
            .first();

        await expect(billRow).toBeVisible({ timeout: 60000 });

        const cells = (await billRow.getByRole('cell').allInnerTexts()).map(text => text.trim());

        expect(cells.length, 'Unexpected bills table structure').toBe(26);

        const invoiceId = cells[8];
        const invoiceStatus = cells[10];
        const billTotalText = cells[7];
        const billTotalCents = moneyToCents(billTotalText);
        const dueCents = moneyToCents(cells[14]);

        expect(invoiceStatus).toBe('CLOSED');
        expect(dueCents, `Amount due should be zero for ${startDate} -> ${endDate}`).toBe(0);
        expect(billTotalCents, 'Intercompany bill total should be positive before credit').toBeGreaterThan(0);

        console.log(`PASS: Invoice ${invoiceId} CLOSED, amount due 0, bill total ${billTotalText}`);

        return { invoiceId, billTotalCents };
    };


    const verifyNewCreditNote = async (invoiceId: string, billTotalCents: number) => {
        for (let attempt = 1; attempt <= 10; attempt++) {
            const notes = await getCreditNotes();

            const matchingNote = notes.find(note =>
                note.invoiceId === invoiceId &&
                note.amountCents === -billTotalCents &&
                note.status === 'ACTIVE'
            );

            if (matchingNote) {
                console.log(`PASS: Invoice ${invoiceId} has matching ACTIVE credit note: ${matchingNote.amountCents / 100}`);
                return new Set(notes.map(note => note.key));
            }

            console.log(`Waiting for credit note for invoice ${invoiceId}: ${attempt}/10`);
            if (attempt < 10) await page.waitForTimeout(5000);
        }

        throw new Error(`No matching ACTIVE credit note found for invoice ${invoiceId}`);
    };


    const verifyWorkOrderActivity = async () => {
        await openAccount();
        await page.locator('a').filter({ hasText: 'Account Data' }).click();
        await page.getByRole('link', { name: /Customer Activity/ }).click();
        await page.getByRole('button', { name: 'Clear' }).click();
        await page.getByRole('button', { name: 'Search' }).click();

        const xmlCell = page.getByRole('cell', { name: 'CREATE_XML_INVOICE', exact: true }).first();
        await expect(xmlCell).toBeVisible();
        const activityTable = xmlCell.locator('xpath=ancestor::table[1]');
        const rows = await activityTable.locator('tbody tr').allInnerTexts();

        const workOrderIndex = rows.findIndex(text => text.includes('UPDATE_WORK_ORDER'));
        const taxIndex = rows.findIndex(text => text.includes('CALCULATE_TAX'));
        const xmlIndex = rows.findIndex(text => text.includes('CREATE_XML_INVOICE'));

        expect(workOrderIndex, 'UPDATE_WORK_ORDER activity not found').toBeGreaterThanOrEqual(0);
        expect(taxIndex, 'CALCULATE_TAX activity not found').toBeGreaterThanOrEqual(0);
        expect(xmlIndex, 'CREATE_XML_INVOICE activity not found').toBeGreaterThanOrEqual(0);
        expect(workOrderIndex, 'Work order must appear above the latest tax activity (newest first)').toBeLessThan(taxIndex);
        expect(workOrderIndex, 'Work order must appear above the latest XML invoice activity (newest first)').toBeLessThan(xmlIndex);

        console.log(`PASS: Work order appears after tax and XML processing (row indexes ${workOrderIndex}, ${taxIndex}, ${xmlIndex})`);
    };

    const runBillingCycle = async (cycle: number, existingNotes: Set<string>) => {
        console.log(`========== TC14 BILLING CYCLE ${cycle} ==========`);
        const pendingBill = await getNextPendingBill();
        await cleanJobs(pendingBill.jobDate);
        await setCcpTime(pendingBill.jobDate);
        await runDailyJob(pendingBill.jobDate);

        const invoice = await verifyClosedBill(pendingBill.startDate, pendingBill.endDate);
        const notes = await verifyNewCreditNote(invoice.invoiceId, invoice.billTotalCents);
        console.log(`PASS: Billing cycle ${cycle} verified for invoice ${invoice.invoiceId}`);
        return notes;
    };

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);
    console.log(`PASS: Login successful, account ${accountId}`);

    const originalNotes = await getCreditNotes();
    let existingNotes = new Set(originalNotes.map(note => note.key));

    existingNotes = await runBillingCycle(1, existingNotes);
    await verifyWorkOrderActivity();
    existingNotes = await runBillingCycle(2, existingNotes);

    console.log('PASS: TC14 - TWO BILLING CYCLES, CREDIT NOTES, CLOSED INVOICES AND WORK ORDER ACTIVITY');
});
