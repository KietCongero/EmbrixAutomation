import { test } from '@playwright/test';
import { ACCOUNT_ID } from '../test-data/testIds';
import { login, verifyServiceStatus, getCcpTime, setCcpTime, getOutstandingInvoices, payOldestInvoice, processOrder, readInvoices, logInvoices, withDay, dayOfMonth } from '../helpers';

// 790115 TC-10 variant for TC-11: same pay-and-reconnect flow as TC790115-10-PayResume, but the
// CCP time is first moved to the 15th of the current month (only forward) so the reconnection
// happens mid-month and the next bill (TC-11) is prorated from the reconnection date (EFT-15).

const RECONNECTION_DAY = Number(process.env.RECONNECTION_DAY ?? 15);

test('790115 TC-10B - pay open invoices and reconnect mid-month', async ({ page, request }) => {
    test.setTimeout(15 * 60 * 1000);

    const accountId = ACCOUNT_ID;

    await login(page);

    // 1. SERVICES MUST BE SUSPENDED
    await verifyServiceStatus(page, accountId, 'SUSPENDED');

    // 2. MOVE THE CCP TIME TO THE RECONNECTION DAY (never back)
    const ccpTime = await getCcpTime(page);
    const reconnectionDate = dayOfMonth(ccpTime) < RECONNECTION_DAY ? withDay(ccpTime, RECONNECTION_DAY) : ccpTime;

    if (reconnectionDate !== ccpTime) await setCcpTime(page, reconnectionDate);
    else console.log(`CCP time ${ccpTime} already on or after day ${RECONNECTION_DAY}; reconnecting today`);

    // 3. PAY THE OPEN INVOICES ONE BY ONE, OLDEST FIRST (a multi-invoice request hits the Embrix
    //    deadlock of handoff finding 1; TC-10 keeps the sheet's one-request form, this spec does not test it)
    const paid: { invoiceId: string; due: number }[] = [];

    for (let attempt = 1; attempt <= 5 && (await getOutstandingInvoices(page, accountId)).length > 0; attempt++) {
        paid.push(await payOldestInvoice(page, request, accountId));
    }

    if (paid.length === 0) console.log('No outstanding invoices: already paid, processing the RESUME order only');

    // 4. AUTOMATIC RESUME ORDER: FIND, COMPLETE PROVISIONING, SUBMIT, VERIFY ACTIVE
    console.log('Waiting for automatic RESUME order...');
    await page.waitForTimeout(5000);

    const resumeOrderId = await processOrder(page, accountId, 'RESUME');

    logInvoices(await readInvoices(page, accountId), 'INVOICES AFTER PAYMENT');

    console.log('================================================');
    console.log('PASS: INVOICES PAID AND SERVICE RECONNECTED MID-MONTH');
    console.log(`Account: ${accountId}`);
    console.log(`Reconnection date: ${reconnectionDate}`);
    console.log(`Paid Invoices: ${paid.map(invoice => `${invoice.invoiceId} (${invoice.due})`).join(', ')}`);
    console.log(`Resume Order: ${resumeOrderId}`);
    console.log('Service Status: ACTIVE');
    console.log('================================================');
});
