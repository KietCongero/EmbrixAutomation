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
export const applyGracePeriod = async (page: Page, accountId: string, suspensionDate: string, gracePeriodDays: number) => {
    const action = await getCollectionAction(page, accountId, { actions: ['INACTIVATE_SUBSCRIPTION'], minimumDate: suspensionDate, maximumDate: suspensionDate });
    expect(action.nextActionDate).toBe(suspensionDate);

    const collectionUnitRow = page.locator('.col-md-12 > #scrollableDiv > .table > tbody > tr').filter({ hasText: suspensionDate }).first();
    await expect(collectionUnitRow).toBeVisible();
    await collectionUnitRow.locator('.custom-control').click();

    const statusSelect = page.locator('.form-group.select-group.col-md-4').filter({ hasText: 'Collection Unit Status' });
    await expect(statusSelect).toBeVisible();
    await statusSelect.click();

    const gracePeriodOption = page.locator('div[id^="react-select-"][id*="-option-"]').filter({ hasText: /^GRACE_PERIOD_REQUESTED$/ });
    await expect(gracePeriodOption).toBeVisible();
    await gracePeriodOption.click();

    await page.getByText('Grace Period', { exact: true }).click();

    const plusButton = page.locator('.plus-number');
    await expect(plusButton).toBeVisible();
    for (let i = 0; i < gracePeriodDays; i++) await plusButton.click();

    const commentBox = page.locator('textarea:visible').first();
    await expect(commentBox).toBeVisible();
    await commentBox.fill(`Grace period requested for ${gracePeriodDays} days from ${suspensionDate}`);
    await page.getByRole('button', { name: 'Apply' }).click();

    console.log(`PASS: ${gracePeriodDays}-day grace period requested for suspension date ${suspensionDate}`);
};
