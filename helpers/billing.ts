import { expect, Page } from '@playwright/test';
import { normalizeDate, moneyToNumber, ordinal } from './dates';
import { openBills } from './ui';
import { setCcpTime } from './ccp';
import { cleanJobs, runBillingDailyJob } from './jobs';

// Billing Data > Bills table (/customers/<id>/bills).
// The table has 26 columns; the indexes below are the ones every spec relies on.

const COL = { startDate: 3, endDate: 4, billTotal: 7, invoiceId: 8, status: 10, folioStatus: 11, due: 14, dueDate: 15 } as const;

export type BillInfo = { startDate: string; endDate: string; jobDate: string; dueDate: string };

export type InvoiceInfo = {
    invoiceId: string;
    startDate: string;
    endDate: string;
    billTotal: number;
    status: string; // ACTIVE | COLLECTION | CLOSED | PENDING ...
    folioStatus: string; // STAMPED ...
    due: number;
    dueDate: string;
};

// Every row of the Bills table that has an invoice ID.
export const readInvoices = async (page: Page, accountId: string): Promise<InvoiceInfo[]> => {
    await openBills(page, accountId);
    await expect(page.getByRole('row').nth(1)).toBeVisible();

    const rows = page.getByRole('row');
    const invoices: InvoiceInfo[] = [];

    for (let i = 0; i < await rows.count(); i++) {
        const values = (await rows.nth(i).getByRole('cell').allInnerTexts()).map(value => value.trim());

        if (values.length !== 26 || !values[COL.invoiceId]) continue;

        invoices.push({
            invoiceId: values[COL.invoiceId],
            startDate: values[COL.startDate],
            endDate: values[COL.endDate],
            billTotal: moneyToNumber(values[COL.billTotal] || '0'),
            status: values[COL.status],
            folioStatus: values[COL.folioStatus],
            due: moneyToNumber(values[COL.due] || '0'),
            dueDate: values[COL.dueDate] ? normalizeDate(values[COL.dueDate]) : '',
        });
    }

    return invoices;
};

export const logInvoices = (invoices: InvoiceInfo[], title = 'INVOICES') => {
    console.log('================================================');
    console.log(title);
    console.log('================================================');
    for (const invoice of invoices) {
        console.log(`${invoice.invoiceId} | ${invoice.startDate} -> ${invoice.endDate} | ${invoice.status} | Total: ${invoice.billTotal} | Due: ${invoice.due} | Due date: ${invoice.dueDate}`);
    }
};

// Outstanding = stamped, not closed, with a balance. Oldest first.
export const getOutstandingInvoices = async (page: Page, accountId: string) =>
    (await readInvoices(page, accountId))
        .filter(invoice => invoice.status !== 'CLOSED' && invoice.folioStatus === 'STAMPED' && invoice.due > 0)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

// First PENDING bill unit: its end date is the day the billing job must run on.
export const getNextPendingBill = async (page: Page, accountId: string): Promise<BillInfo> => {
    await openBills(page, accountId);

    console.log('Looking for next PENDING bill...');

    const pendingBillRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'PENDING', exact: true }) }).first();

    await expect(pendingBillRow).toBeVisible();

    const dateCells = pendingBillRow.getByRole('cell').filter({ hasText: /^\d{4}-\d{2}-\d{2}$/ });
    const startDate = (await dateCells.nth(0).innerText()).trim();
    const endDate = (await dateCells.nth(1).innerText()).trim();

    console.log(`PASS: Next pending bill ${startDate} -> ${endDate}`);

    return { startDate, endDate, jobDate: endDate, dueDate: '' };
};

// Waits until the bill for a period is STAMPED and returns it with its due date.
export const getStampedBillByPeriod = async (page: Page, accountId: string, startDate: string, endDate: string, attempts = 10): Promise<InvoiceInfo> => {
    console.log(`Looking for STAMPED bill ${startDate} -> ${endDate}...`);

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const invoice = (await readInvoices(page, accountId)).find(
            row => row.startDate === startDate && row.endDate === endDate && row.folioStatus === 'STAMPED'
        );

        if (invoice) {
            console.log(`PASS: STAMPED bill found ${startDate} -> ${endDate} | Invoice ${invoice.invoiceId} | Total ${invoice.billTotal} | Due date ${invoice.dueDate}`);
            return invoice;
        }

        console.log(`STAMPED bill not found yet: ${attempt}/${attempts}`);
        await page.waitForTimeout(5000);
    }

    throw new Error(`Could not find STAMPED bill ${startDate} -> ${endDate} for account ${accountId}`);
};

// TC-19: a month fully suspended must close its bill unit at 0 with no invoice.
// Passes when the period is gone from the table or is still there without an invoice/STAMPED folio.
export const verifyNoInvoiceForPeriod = async (page: Page, accountId: string, startDate: string, endDate: string) => {
    const invoice = (await readInvoices(page, accountId)).find(row => row.startDate === startDate && row.endDate === endDate);

    expect(invoice?.folioStatus ?? '', `Period ${startDate} -> ${endDate} should not have been invoiced`).not.toBe('STAMPED');

    console.log(`PASS: No invoice for ${startDate} -> ${endDate}`);
};

// Clean the billing day, move the date there, run billing, return the stamped invoice.
export const runNextBillingCycle = async (page: Page, accountId: string, label = 'BILLING') => {
    console.log('================================================');
    console.log(`STARTING ${label}`);
    console.log('================================================');

    const pendingBill = await getNextPendingBill(page, accountId);

    console.log(`Billing period: ${pendingBill.startDate} -> ${pendingBill.endDate}`);
    console.log(`Billing job date: ${pendingBill.jobDate}`);

    await cleanJobs(pendingBill.jobDate);
    await setCcpTime(page, pendingBill.jobDate);

    const invoiceCheck = await runBillingDailyJob(page, pendingBill.jobDate);

    if (invoiceCheck === 'ERROR') console.log('WARNING: INVOICE_CHECK reported ERROR. Verifying whether the invoice was generated...');

    const bill = await getStampedBillByPeriod(page, accountId, pendingBill.startDate, pendingBill.endDate);

    console.log(`PASS: ${label} COMPLETE | ${bill.startDate} -> ${bill.endDate} | Due ${bill.dueDate}`);

    return { ...bill, jobDate: pendingBill.jobDate, invoiceCheck };
};

// Same cycle, but for a month that must NOT produce an invoice (TC-19).
export const runBillingCycleExpectingNoInvoice = async (page: Page, accountId: string, label = 'BILLING (no invoice expected)') => {
    const pendingBill = await getNextPendingBill(page, accountId);

    await cleanJobs(pendingBill.jobDate);
    await setCcpTime(page, pendingBill.jobDate);
    await runBillingDailyJob(page, pendingBill.jobDate);
    await verifyNoInvoiceForPeriod(page, accountId, pendingBill.startDate, pendingBill.endDate);

    console.log(`PASS: ${label} COMPLETE | ${pendingBill.startDate} -> ${pendingBill.endDate}`);

    return pendingBill;
};

// Billing Data > Bills > row action EXTEND_DUE_DATE (from TC10-GracePeriod). `newDueDate` is YYYY-MM-DD.
export const extendDueDate = async (page: Page, accountId: string, invoiceId: string, newDueDate: string, note: string) => {
    await openBills(page, accountId);

    const billRow = page.getByRole('row').filter({ hasText: invoiceId }).first();
    await expect(billRow).toBeVisible();

    await billRow.locator('td > .check-item > .custom-control').first().click();

    const actionSelect = page.locator('div').filter({ hasText: /^Action\s*<Select Action>$/ }).last();
    await actionSelect.click();
    await page.getByText('EXTEND_DUE_DATE', { exact: true }).click();

    const [year, month, day] = newDueDate.split('-').map(Number);
    const dueDateInput = page.locator('input[id^="date-"]:visible').last();
    await dueDateInput.click();

    await page.getByRole('combobox').nth(1).selectOption(String(year));
    await page.getByRole('combobox').first().selectOption(String(month - 1));

    const dateObject = new Date(year, month - 1, day);
    const weekdayName = dateObject.toLocaleString('en-US', { weekday: 'long' });
    const monthName = dateObject.toLocaleString('en-US', { month: 'long' });

    await page.getByRole('button', { name: new RegExp(`Choose ${weekdayName}, ${monthName} ${ordinal(day)}`) }).click();
    await page.locator('textarea:visible').last().fill(note);
    await page.getByText('Submit', { exact: true }).click();

    const closeButton = page.getByRole('button', { name: 'close' });
    if (await closeButton.isVisible().catch(() => false)) await closeButton.click();

    await page.waitForTimeout(2000);

    const updated = (await readInvoices(page, accountId)).find(invoice => invoice.invoiceId === invoiceId);

    expect(updated?.dueDate, `Due date of ${invoiceId} should be ${newDueDate}`).toBe(newDueDate);

    console.log(`PASS: Due date of ${invoiceId} extended to ${newDueDate}`);
};
