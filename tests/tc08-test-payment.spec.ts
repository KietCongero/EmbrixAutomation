
import { test, expect } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { env } from '../config/environments';

test('Pay oldest invoice in COLLECTION and verify payment', async ({ page, request }) => {
    test.setTimeout(3 * 60 * 1000);

    const username = env.username;
    const password = env.password;
    const apiToken = env.apiToken;
    const accountId = ACCOUNT_ID;

    const paymentUrl = env.api.applyPayment;

    if (!username || !password || !apiToken) throw new Error('Missing environment variables');

    // ============================================================
    // LOGIN
    // ============================================================

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

    console.log('PASS: Login successful');

    // ============================================================
    // OPEN BILLS
    // ============================================================

    const openBills = async () => {
        await page.goto(`/customers/${accountId}/bills`);
        await expect(page.getByRole('row').filter({ hasText: 'STAMPED' }).first()).toBeVisible();
    };

    // ============================================================
    // READ INVOICES
    // ============================================================

    const readInvoices = async () => {
        const rows = page.getByRole('row');

        const invoices: {
            invoiceId: string;
            startDate: string;
            endDate: string;
            status: string;
            folioStatus: string;
            due: number;
        }[] = [];

        for (let i = 0; i < await rows.count(); i++) {
            const values = (await rows.nth(i).getByRole('cell').allInnerTexts()).map(value => value.trim());

            if (values.length !== 26) continue;

            const invoiceId = values[8];
            const due = Number(values[14].replace(/,/g, '').replace(/[^\d.-]/g, ''));

            if (!invoiceId) continue;

            invoices.push({
                invoiceId,
                startDate: values[3],
                endDate: values[4],
                status: values[10],
                folioStatus: values[11],
                due
            });
        }

        return invoices;
    };

    // ============================================================
    // FIND OLDEST INVOICE IN COLLECTION
    // ============================================================

    await openBills();

    const invoicesBefore = await readInvoices();

    console.log('================================================');
    console.log('INVOICES BEFORE PAYMENT');
    console.log('================================================');

    for (const invoice of invoicesBefore) {
        console.log(`${invoice.invoiceId} | ${invoice.startDate} -> ${invoice.endDate} | ${invoice.status} | Due: ${invoice.due}`);
    }

    const collectionInvoices = invoicesBefore
        .filter(invoice => invoice.status === 'COLLECTION' && invoice.folioStatus === 'STAMPED' && Number.isFinite(invoice.due) && invoice.due > 0)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

    if (collectionInvoices.length === 0) throw new Error(`No outstanding COLLECTION invoices found for account ${accountId}`);

    const oldestInvoice = collectionInvoices[0];

    console.log('================================================');
    console.log('SELECTED OLDEST COLLECTION INVOICE');
    console.log(`Invoice ID: ${oldestInvoice.invoiceId}`);
    console.log(`Period: ${oldestInvoice.startDate} -> ${oldestInvoice.endDate}`);
    console.log(`Amount: ${oldestInvoice.due} CRC`);
    console.log('================================================');

    // ============================================================
    // PAY OLDEST COLLECTION INVOICE
    // ============================================================

    const response = await request.post(paymentUrl, {
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        data: {
            id: '',
            paymentSourceId: '',
            paymentDate: '',
            paymentSource: 'BCR',
            allocationData: [{
                accountId,
                invoiceId: oldestInvoice.invoiceId,
                currency: 'CRC',
                amount: oldestInvoice.due,
            }],
        },
    });

    const body = await response.json();

    console.log('Payment response:', body);

    expect(response.ok()).toBeTruthy();
    expect(body.status).toBe('SUCCESS');
    expect(body.statusCode).toBe('0');

    console.log(`PASS: Payment accepted for invoice ${oldestInvoice.invoiceId}`);

    // ============================================================
    // VERIFY PAYMENT
    // ============================================================

    let paidInvoice = null;

    for (let attempt = 1; attempt <= 10; attempt++) {
        console.log(`Checking invoice ${oldestInvoice.invoiceId}: ${attempt}/10`);

        await openBills();

        const invoicesAfter = await readInvoices();

        paidInvoice = invoicesAfter.find(invoice => invoice.invoiceId === oldestInvoice.invoiceId) ?? null;

        if (paidInvoice) {
            console.log(`Invoice Status: ${paidInvoice.status}`);
            console.log(`Outstanding Due: ${paidInvoice.due}`);
        }

        if (paidInvoice?.due === 0) break;

        if (attempt < 10) await page.waitForTimeout(5000);
    }

    expect(paidInvoice, `Invoice ${oldestInvoice.invoiceId} not found after payment`).not.toBeNull();
    expect(paidInvoice?.due, `Invoice ${oldestInvoice.invoiceId} still has an outstanding balance`).toBe(0);

    // ============================================================
    // VERIFY FINAL RESULT
    // ============================================================

    console.log('================================================');
    console.log('PASS: OLDEST COLLECTION INVOICE PAID');
    console.log(`Account: ${accountId}`);
    console.log(`Invoice ID: ${oldestInvoice.invoiceId}`);
    console.log(`Period: ${oldestInvoice.startDate} -> ${oldestInvoice.endDate}`);
    console.log(`Amount Paid: ${oldestInvoice.due} CRC`);
    console.log(`Final Invoice Status: ${paidInvoice?.status}`);
    console.log('Final Outstanding Due: 0');
    console.log('================================================');
});
