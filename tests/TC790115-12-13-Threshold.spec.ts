import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, getOutstandingInvoices, payInvoicePartially, waitForInvoice } from '../helpers';

// 790115 TC-12 / TC-13: payment threshold (CRC = 1 colón).
//   TC-12: pay balance - 2.00 -> the invoice stays open with 2.00 due (outside the threshold).
//   TC-13: pay 1.50 -> the invoice closes with 0 due; 0.50 recorded as a rounding adjustment.
// Same applyPayment call as TC08's payBill with a different amount. The threshold value in
// Basic Settings and the adjustment in Billing Data > Transactions are not read (not automated).

test('790115 TC-12/13 - underpayment outside and within the 1 colón threshold', async ({ page, request }) => {
    test.setTimeout(10 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    const [invoice] = await getOutstandingInvoices(page, accountId);

    if (!invoice) throw new Error(`No outstanding invoice for account ${accountId}`);

    console.log('================================================');
    console.log(`INVOICE ${invoice.invoiceId} | ${invoice.startDate} -> ${invoice.endDate} | Due ${invoice.due}`);
    console.log('================================================');

    // TC-12: balance - 2.00
    const firstAmount = Math.round((invoice.due - 2) * 100) / 100;
    await payInvoicePartially(page, request, accountId, invoice.invoiceId, firstAmount, 'TEST-EFT63-R3');
    const afterFirst = await waitForInvoice(page, accountId, invoice.invoiceId, row => row.due < invoice.due);

    console.log('================================================');
    console.log(`TC-12 after paying ${firstAmount}: ${afterFirst.status} | Due ${afterFirst.due} | sheet expects open with 2.00 due: ${afterFirst.status !== 'CLOSED' && afterFirst.due === 2 ? 'MATCH' : 'DIFFERS'}`);
    console.log('================================================');

    // TC-13: 1.50 within the threshold
    await payInvoicePartially(page, request, accountId, invoice.invoiceId, 1.5, 'TEST-EFT63-R1');
    const afterSecond = await waitForInvoice(page, accountId, invoice.invoiceId, row => row.due < afterFirst.due);

    console.log('================================================');
    console.log(`TC-13 after paying 1.50: ${afterSecond.status} | Due ${afterSecond.due} | sheet expects CLOSED with 0 due: ${afterSecond.status === 'CLOSED' && afterSecond.due === 0 ? 'MATCH' : 'DIFFERS'}`);
    console.log('The 0.50 "Ajuste por redondeo en pago" in Billing Data > Transactions is not read by this spec.');
    console.log('================================================');
});
