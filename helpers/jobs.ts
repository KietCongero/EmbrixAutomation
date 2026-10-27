import { expect, Page } from '@playwright/test';
import { queryDatabase } from './database';
import { q09JobSchedules } from './queries';
import { setCcpTime } from './ccp';
import { eachDay, endOfMonth } from './dates';

// Operations Hub > Jobs Management > DAILY job schedule (R05).
//
// Rules from the 790115 Read Me:
//  - setCcpTime moves the date only. Process the day's job schedule afterwards and wait for it.
//  - Use Process (or Reprocess for errors), never Recreate.
//  - Delete a job schedule only when it has 0 pending jobs and the previous day has not been
//    processed yet. Once a collection starts, Embrix queues the next action's job inside the next
//    day's schedule; deleting that schedule orphans the job silently (the reminder never goes out).

export const DAILY_JOB_URL = '/jobs-management/job-schedule/CJ-12';

export type JobSchedule = { id: string; scheduledate: Date | string; status: string };

export const getJobSchedules = (targetDate: string) =>
    queryDatabase<JobSchedule>(`SELECT id, scheduledate, status FROM core_engine.job_schedule WHERE scheduledate = $1`, [targetDate]);

// Q09 guard: how many PENDING jobs hang off the schedules of a date.
export const getPendingJobCount = async (targetDate: string) => {
    const rows = await q09JobSchedules([targetDate]);
    return rows.reduce((sum, row) => sum + Number(row.pending_jobs), 0);
};

// Deletes the job schedules of one date (leftovers from earlier runs make Process / Create Job
// Schedule hang on demo). Refuses when a schedule still has pending jobs, because that is work
// Embrix queued for that day; pass { force: true } only when you know what you are dropping.
export const cleanJobs = async (targetDate: string, options: { force?: boolean } = {}) => {
    console.log(`Cleaning jobs for ${targetDate}...`);

    const jobs = await getJobSchedules(targetDate);

    if (jobs.length === 0) {
        console.log(`No job schedule for ${targetDate}`);
        return;
    }

    const pending = await getPendingJobCount(targetDate);

    if (pending > 0 && !options.force) {
        throw new Error(`Job schedule for ${targetDate} has ${pending} PENDING job(s); not deleting it (Q09). Run it with runExistingDailyJob instead.`);
    }

    for (const job of jobs) {
        await queryDatabase(`DELETE FROM core_engine.job_schedule_list WHERE id = $1`, [job.id]);
        await queryDatabase(`DELETE FROM core_engine.job_schedule WHERE id = $1`, [job.id]);
        console.log(`PASS: Deleted job schedule ${job.id}`);
    }

    const remaining = await getJobSchedules(targetDate);
    expect(remaining.length, `Jobs still exist for ${targetDate}`).toBe(0);
};

// Cleans every date from `fromDate` through the end of that month. Use it once, before the
// collection entry day, so Embrix schedules fresh jobs for the reminder and suspension days.
export const cleanJobsThroughMonthEnd = async (fromDate: string, options: { force?: boolean } = {}) => {
    console.log(`Cleaning job schedules from ${fromDate} through ${endOfMonth(fromDate)}`);

    for (const date of eachDay(fromDate, endOfMonth(fromDate))) await cleanJobs(date, options);

    console.log('PASS: Job schedules cleaned');
};

export const fillJobDate = async (page: Page, targetDate: string) => {
    const dateInput = page.getByRole('textbox').first();

    await dateInput.click();
    await dateInput.press('ControlOrMeta+a');
    await dateInput.fill(targetDate);
    await dateInput.press('Escape');

    console.log(`Job date selected: ${targetDate}`);
};

export const waitAfterJobRun = async (page: Page, attempts = 6) => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        console.log(`Refreshing jobs: ${attempt}/${attempts}`);

        await page.waitForTimeout(5000);
        await page.getByTitle('Refresh jobs').click();

        const completed = page.getByText('Completed', { exact: true }).first();

        if (await completed.isVisible().catch(() => false)) {
            console.log('PASS: Job processing shows COMPLETED');
            return;
        }
    }

    console.log('WARNING: Completed status not detected');
};

const clickProcess = async (page: Page, buttonName: 'Process' | 'Reprocess') => {
    await expect(page.getByRole('button', { name: buttonName })).toBeVisible();
    await page.getByRole('button', { name: buttonName }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
};

// A day with no schedule yet (billing day, collection entry day): create it, then Process.
export const createAndRunDailyJob = async (page: Page, targetDate: string) => {
    console.log(`Creating DAILY job for ${targetDate}...`);

    await page.goto(DAILY_JOB_URL);
    await fillJobDate(page, targetDate);
    await page.getByRole('button', { name: 'Create Job Schedule' }).click();
    await page.getByTitle('Refresh jobs').click();
    await page.waitForTimeout(5000);
    await clickProcess(page, 'Process');

    console.log(`PASS: Processing started for ${targetDate}`);

    await waitAfterJobRun(page);
};

// A day whose schedule Embrix already created (reminder, suspension, notice days): just Process.
export const runExistingDailyJob = async (page: Page, targetDate: string) => {
    console.log(`Running existing DAILY job for ${targetDate}...`);

    await page.goto(DAILY_JOB_URL);
    await fillJobDate(page, targetDate);
    await page.getByTitle('Refresh jobs').click();
    await page.waitForTimeout(5000);
    await clickProcess(page, 'Process');

    console.log(`PASS: Processing started for ${targetDate}`);

    await waitAfterJobRun(page);
};

// Reprocess only retries the records in error (TC-04 after fixing the identity document).
// Not exercised by any spec yet; the button name follows R05 and may need adjusting.
export const reprocessDailyJob = async (page: Page, targetDate: string) => {
    console.log(`Reprocessing DAILY job for ${targetDate}...`);

    await page.goto(DAILY_JOB_URL);
    await fillJobDate(page, targetDate);
    await page.getByTitle('Refresh jobs').click();
    await page.waitForTimeout(5000);

    const reprocess = page.getByRole('button', { name: 'Reprocess' });

    if (await reprocess.isVisible().catch(() => false)) {
        await clickProcess(page, 'Reprocess');
    } else {
        const buttons = (await page.getByRole('button').allInnerTexts()).map(text => text.trim()).filter(Boolean);
        console.log(`WARNING: no Reprocess button for ${targetDate} (buttons: ${buttons.join(', ')}); using Process`);
        await clickProcess(page, 'Process');
    }

    await waitAfterJobRun(page);
};

// Move the date to `targetDate` and process that day. Creates the schedule when none exists,
// otherwise runs the one Embrix queued (never deletes it).
export const processDay = async (page: Page, targetDate: string) => {
    await setCcpTime(page, targetDate);

    const jobs = await getJobSchedules(targetDate);

    if (jobs.length === 0) await createAndRunDailyJob(page, targetDate);
    else await runExistingDailyJob(page, targetDate);
};

// Same as processDay but fails when Embrix did not schedule the day itself (reminder / suspension days).
export const processEmbrixDay = async (page: Page, targetDate: string) => {
    await setCcpTime(page, targetDate);

    const jobs = await getJobSchedules(targetDate);

    if (jobs.length === 0) throw new Error(`Embrix did not schedule a DAILY job for ${targetDate}`);

    await runExistingDailyJob(page, targetDate);
};

export type InvoiceCheckStatus = 'COMPLETED' | 'ERROR' | 'UNKNOWN';

// Billing day: create + Process, then poll the INVOICE_CHECK job until it finishes.
// Returns the status instead of failing, so the caller can decide (TC-04 expects ERROR).
export const runBillingDailyJob = async (page: Page, targetDate: string, attempts = 20): Promise<InvoiceCheckStatus> => {
    console.log(`Running billing DAILY job for ${targetDate}...`);

    await page.goto(DAILY_JOB_URL);
    await fillJobDate(page, targetDate);
    await page.getByRole('button', { name: 'Create Job Schedule' }).click();
    await page.getByTitle('Refresh jobs').click();
    await page.waitForTimeout(2000);
    await clickProcess(page, 'Process');

    console.log(`PASS: Billing processing started for ${targetDate}`);

    await page.waitForTimeout(15000);

    let invoiceStatus: InvoiceCheckStatus = 'UNKNOWN';

    for (let attempt = 1; attempt <= attempts; attempt++) {
        console.log(`Checking INVOICE_CHECK ${targetDate}: ${attempt}/${attempts}`);

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

    console.log(`Final INVOICE_CHECK status: ${invoiceStatus}`);

    return invoiceStatus;
};
