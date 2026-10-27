import { APIRequestContext, expect, Page } from '@playwright/test';
import { env } from '../config/environments';
import { getOutstandingInvoices, readInvoices, InvoiceInfo } from './billing';

// POST /applyPayment (R03 several invoices, R04 one invoice / partial amount).

export type Allocation = { invoiceId: string; amount: number };

type PaymentDetail = { invoiceId: string; status: string; id?: string; statusCode?: string; errorMsg?: string };

const postPayment = async (request: APIRequestContext, accountId: string, allocations: Allocation[], paymentSourceId: string): Promise<PaymentDetail[]> => {
    const data = {
        id: '',
        paymentSourceId,
        paymentDate: '',
        paymentSource: 'BCR',
        allocationData: allocations.map(allocation => ({ accountId, invoiceId: allocation.invoiceId, currency: 'CRC', amount: allocation.amount })),
    };

    console.log('Payment request:', JSON.stringify(data));

    const response = await request.post(env.api.applyPayment, {
        headers: { Authorization: `Bearer ${env.apiToken}`, 'Content-Type': 'application/json' },
        data,
    });

    const text = await response.text();

    console.log('Payment response:', text);

    expect(response.ok(), `Payment failed: ${response.status()} ${text}`).toBeTruthy();

    const body = JSON.parse(text);

    // One allocation answers { status, statusCode, id }; several answer { paymentDetails: [ ... ] } in request order.
    const details: Omit<PaymentDetail, 'invoiceId'>[] = Array.isArray(body.paymentDetails) ? body.paymentDetails : [body];

    return allocations.map((allocation, index) => ({ invoiceId: allocation.invoiceId, ...(details[index] ?? { status: 'MISSING' }) }));
};

// With { strict: false } a FAILED allocation is reported and returned instead of failing the test.
// Seen on demo: paying two or three invoices in one request makes Embrix report a Postgres deadlock
// on one allocation even though that payment is applied (a retry answers "Invoice due already paid").
// payAllOutstandingInvoices therefore checks the Bills table after the request rather than retrying.
export const payInvoices = async (request: APIRequestContext, accountId: string, allocations: Allocation[], paymentSourceId = '', options: { strict?: boolean } = {}) => {
    if (!env.apiToken) throw new Error('Missing EMBRIX_API_TOKEN');
    if (allocations.length === 0) throw new Error('No invoices to pay');

    const results = await postPayment(request, accountId, allocations, paymentSourceId);
    const failed = results.filter(result => result.status !== 'SUCCESS');

    if (failed.length > 0) {
        console.log(`WARNING: ${failed.length} allocation(s) did not succeed: ${failed.map(f => `${f.invoiceId} ${f.status} ${f.errorMsg?.split('\n')[0] ?? ''}`).join(' | ')}`);
    }

    if (options.strict !== false) {
        for (const result of results) {
            expect(result.status, `Payment for invoice ${result.invoiceId} did not succeed: ${result.errorMsg ?? result.status}`).toBe('SUCCESS');
        }
    }

    console.log(`Payment result: ${results.map(r => `${r.invoiceId} ${r.status}${r.id ? ` (${r.id})` : ''}`).join(', ')}`);

    return results;
};

// Polls the Bills table until the invoice matches (e.g. CLOSED with due 0, or ACTIVE with due 2).
export const waitForInvoice = async (page: Page, accountId: string, invoiceId: string, matches: (invoice: InvoiceInfo) => boolean, attempts = 10) => {
    let invoice: InvoiceInfo | undefined;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        invoice = (await readInvoices(page, accountId)).find(row => row.invoiceId === invoiceId);

        if (invoice) console.log(`Invoice ${invoiceId}: ${invoice.status} | Due ${invoice.due} (${attempt}/${attempts})`);
        if (invoice && matches(invoice)) return invoice;

        if (attempt < attempts) await page.waitForTimeout(5000);
    }

    throw new Error(`Invoice ${invoiceId} did not reach the expected state (last: ${invoice ? `${invoice.status} due ${invoice.due}` : 'not found'})`);
};

export const waitForInvoiceClosed = (page: Page, accountId: string, invoiceId: string) =>
    waitForInvoice(page, accountId, invoiceId, invoice => invoice.status === 'CLOSED' && invoice.due === 0);

// Pay the oldest outstanding invoice in full and wait for CLOSED (what TC08.payBill did).
export const payOldestInvoice = async (page: Page, request: APIRequestContext, accountId: string) => {
    const [oldest] = await getOutstandingInvoices(page, accountId);

    if (!oldest) throw new Error(`No outstanding invoices found for account ${accountId}`);

    console.log(`Paying oldest outstanding invoice ${oldest.invoiceId} | ${oldest.startDate} -> ${oldest.endDate} | ${oldest.due} CRC`);

    await payInvoices(request, accountId, [{ invoiceId: oldest.invoiceId, amount: oldest.due }]);
    await waitForInvoiceClosed(page, accountId, oldest.invoiceId);

    return oldest;
};

// Pay every outstanding invoice in one request (TC-10 / TC-20: both open invoices while suspended).
export const payAllOutstandingInvoices = async (page: Page, request: APIRequestContext, accountId: string) => {
    const outstanding = await getOutstandingInvoices(page, accountId);

    if (outstanding.length === 0) throw new Error(`No outstanding invoices found for account ${accountId}`);

    const results = await payInvoices(request, accountId, outstanding.map(invoice => ({ invoiceId: invoice.invoiceId, amount: invoice.due })), '', { strict: false });

    for (const invoice of outstanding) {
        const result = results.find(r => r.invoiceId === invoice.invoiceId);

        try {
            await waitForInvoiceClosed(page, accountId, invoice.invoiceId);
            if (result?.status !== 'SUCCESS') console.log(`Invoice ${invoice.invoiceId} is CLOSED although its allocation answered ${result?.status}: the payment was applied`);
        } catch (error) {
            if (result?.status === 'SUCCESS') throw error;

            console.log(`Invoice ${invoice.invoiceId} still open after a ${result?.status} allocation: paying it on its own`);
            await payInvoices(request, accountId, [{ invoiceId: invoice.invoiceId, amount: invoice.due }]);
            await waitForInvoiceClosed(page, accountId, invoice.invoiceId);
        }
    }

    return outstanding;
};

// Partial payment (TC-12 / TC-13 threshold cases): pays `amount` and returns the refreshed invoice.
export const payInvoicePartially = async (page: Page, request: APIRequestContext, accountId: string, invoiceId: string, amount: number, paymentSourceId = '') => {
    await payInvoices(request, accountId, [{ invoiceId, amount }], paymentSourceId);
    await page.waitForTimeout(5000);

    const invoice = (await readInvoices(page, accountId)).find(row => row.invoiceId === invoiceId);

    if (!invoice) throw new Error(`Invoice ${invoiceId} not found after payment`);

    console.log(`Invoice ${invoiceId} after paying ${amount}: ${invoice.status} | Due ${invoice.due}`);

    return invoice;
};
