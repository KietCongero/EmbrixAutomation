import { expect, Page } from '@playwright/test';
import { normalizeDate, endOfMonth } from './dates';

// AR Hub > Collections > account > View. Reads the action rows of the collection unit.

export const COLLECTION_ACTIONS = ['COLLECTION_ENTRY', 'FIRST_REMINDER_EMAIL', 'INACTIVATE_SUBSCRIPTION', 'NOTIFY_CANCELLATION_TO_CRM'] as const;

export type CollectionAction = (typeof COLLECTION_ACTIONS)[number];

export type CollectionActionRow = { action: string; nextActionDate: string };

export const openCollection = async (page: Page, accountId: string) => {
    await page.goto('/dashboard/me');
    await page.getByRole('button', { name: 'AR Hub' }).click();
    await page.getByRole('link', { name: 'Collections' }).click();

    const collectionSearch = page.locator('.form-group').first().getByRole('textbox');

    await collectionSearch.fill(accountId);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.waitForTimeout(3000);

    const viewCell = page.getByRole('cell', { name: 'View', exact: true }).first();

    if (!(await viewCell.isVisible().catch(() => false))) return false;

    await viewCell.click();
    await page.waitForTimeout(2000);

    return true;
};

// All action rows currently shown for the account (every View table), newest last.
export const readCollectionActions = async (page: Page, accountId: string): Promise<CollectionActionRow[]> => {
    if (!(await openCollection(page, accountId))) return [];

    const actionCells = page.getByRole('cell', { name: new RegExp(`^(${COLLECTION_ACTIONS.join('|')})$`) });
    const rows: CollectionActionRow[] = [];

    for (let index = 0; index < await actionCells.count(); index++) {
        const actionCell = actionCells.nth(index);
        const action = (await actionCell.innerText()).trim();
        const actionRow = actionCell.locator('xpath=ancestor::tr[1]');
        const table = actionRow.locator('xpath=ancestor::table[1]');
        const headers = await table.getByRole('columnheader').allInnerTexts();
        const dateIndex = headers.findIndex(text => text.trim() === 'Next Action Date');

        if (dateIndex === -1) throw new Error('Could not find Next Action Date column');

        rows.push({ action, nextActionDate: normalizeDate(await actionRow.getByRole('cell').nth(dateIndex).innerText()) });
    }

    return rows;
};

type ActionQuery = {
    actions?: readonly string[]; // which actions count; default: all
    minimumDate: string; // ignore rows older than this (rows from earlier months stay on the page)
    maximumDate?: string; // default: end of minimumDate's month
    attempts?: number;
    waitSeconds?: number;
};

// The newest action row in the date window. Polls because Embrix writes the row a little after the job.
export const getCollectionAction = async (page: Page, accountId: string, query: ActionQuery): Promise<CollectionActionRow> => {
    const { actions = COLLECTION_ACTIONS, minimumDate, maximumDate = endOfMonth(minimumDate), attempts = 10, waitSeconds = 5 } = query;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        console.log(`Collection search ${attempt}/${attempts}: ${actions.join('|')} between ${minimumDate} and ${maximumDate}`);

        const rows = (await readCollectionActions(page, accountId)).filter(
            row => actions.includes(row.action) && row.nextActionDate >= minimumDate && row.nextActionDate <= maximumDate
        );

        if (rows.length > 0) {
            const row = rows[rows.length - 1];
            console.log(`PASS: Current collection action = ${row.action} on ${row.nextActionDate}`);
            return row;
        }

        console.log('No matching collection action yet...');
        if (attempt < attempts) await page.waitForTimeout(waitSeconds * 1000);
    }

    throw new Error(`Could not find ${actions.join('|')} between ${minimumDate} and ${maximumDate} for account ${accountId}`);
};

export const expectCollectionAction = async (page: Page, accountId: string, action: CollectionAction, expectedDate: string, minimumDate = expectedDate.slice(0, 8) + '01') => {
    const row = await getCollectionAction(page, accountId, { actions: [action], minimumDate });
    expect(row.nextActionDate, `${action} should be scheduled on ${expectedDate}`).toBe(expectedDate);
    return row;
};

// Collections screen > tick the unit > Collection Unit Status = GRACE_PERIOD_REQUESTED > days > note > Apply.
// `suspensionDate` is the INACTIVATE_SUBSCRIPTION date shown for the unit (used to pick the row).
// The unit is picked by its invoice: units of paid invoices stay on the page as CLOSED with their
// last planned action, and a CLOSED unit cannot be changed (Apply stays disabled).
export const applyGracePeriod = async (page: Page, accountId: string, invoiceId: string, gracePeriodDays: number) => {
    if (!(await openCollection(page, accountId))) throw new Error(`No collection units shown for account ${accountId}`);

    const collectionUnitRow = page.locator('.col-md-12 > #scrollableDiv > .table > tbody > tr').filter({ hasText: invoiceId }).first();
    await expect(collectionUnitRow, `No collection unit for invoice ${invoiceId}`).toBeVisible();

    console.log(`Collection unit of ${invoiceId}: ${(await collectionUnitRow.innerText()).replace(/\s+/g, ' ').trim()}`);

    await collectionUnitRow.locator('.custom-control').click();

    const statusSelect = page.locator('.form-group.select-group.col-md-4').filter({ hasText: 'Collection Unit Status' });
    await expect(statusSelect).toBeVisible();

    // The react-select sometimes closes before the option click registers (seen on TC-23 scenario B:
    // Apply stayed disabled). Open it, pick the option and check the control shows it; retry if not.
    const selectGracePeriod = async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await statusSelect.click();

            const gracePeriodOption = page.locator('div[id^="react-select-"][id*="-option-"]').filter({ hasText: /^GRACE_PERIOD_REQUESTED$/ });
            await expect(gracePeriodOption).toBeVisible();
            await gracePeriodOption.click();
            await page.waitForTimeout(500);

            if (await statusSelect.filter({ hasText: 'GRACE_PERIOD_REQUESTED' }).isVisible().catch(() => false)) return;

            console.log(`WARNING: Collection Unit Status does not show GRACE_PERIOD_REQUESTED (attempt ${attempt}/3)`);
        }

        throw new Error('Could not select GRACE_PERIOD_REQUESTED in Collection Unit Status');
    };

    await selectGracePeriod();

    await page.getByText('Grace Period', { exact: true }).click();

    const plusButton = page.locator('.plus-number');
    await expect(plusButton).toBeVisible();
    for (let i = 0; i < gracePeriodDays; i++) await plusButton.click();

    const commentBox = page.locator('textarea:visible').first();
    await expect(commentBox).toBeVisible();
    await commentBox.fill(`Grace period requested for ${gracePeriodDays} days on invoice ${invoiceId}`);

    const applyButton = page.getByRole('button', { name: 'Apply' });

    if (!(await applyButton.isEnabled().catch(() => false))) {
        console.log('WARNING: Apply is disabled after filling the form; selecting the status again');
        await selectGracePeriod();
    }

    await expect(applyButton, 'Apply stayed disabled: status, grace days or comment not accepted by the form').toBeEnabled({ timeout: 10000 });
    await applyButton.click();

    console.log(`PASS: ${gracePeriodDays}-day grace period requested on invoice ${invoiceId}`);
};

export type CollectionUnitRow = { invoiceId: string; status: string; action: string; nextActionDate: string; lastActionDate: string; text: string };

// The unit row of one invoice in the Collections table (status, next action and its date), or undefined.
export const readCollectionUnit = async (page: Page, accountId: string, invoiceId: string): Promise<CollectionUnitRow | undefined> => {
    if (!(await openCollection(page, accountId))) return undefined;

    const row = page.locator('.col-md-12 > #scrollableDiv > .table > tbody > tr').filter({ hasText: invoiceId }).first();

    if (!(await row.isVisible().catch(() => false))) return undefined;

    const text = (await row.innerText()).replace(/\s+/g, ' ').trim();
    // "... VIEW 418817 CLOSED REGULAR <last action date> <next action date> INACTIVATE_SUBSCRIPTION <entry date> ..."
    const stamp = '(\\d{4}-\\d{2}-\\d{2}) \\d{2}:\\d{2}:\\d{2}\\.\\d';
    const next = text.match(new RegExp(`${stamp} ${stamp} (${COLLECTION_ACTIONS.join('|')})\\b`));
    const status = text.match(new RegExp(`${invoiceId} (\\w+)`))?.[1] ?? '';

    return { invoiceId, status, action: next?.[3] ?? '', nextActionDate: next?.[2] ?? '', lastActionDate: next?.[1] ?? '', text };
};

// ============================================================
// DAY-BY-DAY COLLECTION (790115 TC-16 / TC-21)
// ============================================================
// Processes every day from the due date to the expected suspension day (the 21st), reads the
// collection unit after each day, completes the SUSPEND order, then processes the next day
// (the cancellation notice). Nothing is asserted: each day's current action is logged.

import { cleanJobsThroughMonthEnd, processDay } from './jobs';
import { processOrder } from './orders';
import { addDays, eachDay, expectedCollectionDates, withDay } from './dates';

export const runCollectionDayByDay = async (page: Page, accountId: string, dueDate: string) => {
    const expected = expectedCollectionDates(dueDate, 'eft102');

    console.log('================================================');
    console.log(`COLLECTION DAY BY DAY: due ${dueDate} | expected reminder ${expected.reminder} | suspension ${expected.suspension} | notice ${expected.notice}`);
    console.log('================================================');

    // Once, before the collection starts (demo leftovers only)
    await cleanJobsThroughMonthEnd(withDay(dueDate, 16));

    // The unit's rows appear a little after the job; poll up to 30 s for a row newer than the day processed.
    const logCurrentAction = async (day: string) => {
        let current: CollectionActionRow | undefined;

        for (let attempt = 1; attempt <= 6; attempt++) {
            current = (await readCollectionActions(page, accountId)).filter(row => row.nextActionDate >= dueDate).pop();
            if (current && current.nextActionDate > day) break;
            await page.waitForTimeout(5000);
        }

        console.log(`${day} processed | current collection action: ${current ? `${current.action} on ${current.nextActionDate}` : 'none shown'}`);
        return current;
    };

    let afterSuspension: CollectionActionRow | undefined;

    for (const day of eachDay(dueDate, expected.suspension)) {
        await processDay(page, day);
        afterSuspension = await logCurrentAction(day);
    }

    const suspendOrderId = await processOrder(page, accountId, 'SUSPEND');

    // The notice planned after the suspension day is the row to compare; once the notice day is
    // processed the unit has no next action left to show.
    const noticeDay = addDays(expected.suspension, 1);
    await processDay(page, noticeDay);
    await logCurrentAction(noticeDay);

    console.log('================================================');
    console.log(`Suspend order: ${suspendOrderId} | services SUSPENDED on ${expected.suspension}`);
    console.log(`Sheet expects NOTIFY_CANCELLATION_TO_CRM planned for ${expected.notice}: ${afterSuspension?.action === 'NOTIFY_CANCELLATION_TO_CRM' && afterSuspension.nextActionDate === expected.notice ? 'MATCH' : `DIFFERS (${afterSuspension ? `${afterSuspension.action} ${afterSuspension.nextActionDate}` : 'none shown'})`}`);
    console.log('================================================');

    return { suspendOrderId, suspensionDate: expected.suspension, noticeDate: noticeDay };
};
