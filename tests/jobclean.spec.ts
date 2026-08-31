import { test, expect } from '@playwright/test';
import { queryDatabase } from '../helpers/database';

test('delete existing billing jobs for target dates', async () => {
    const targetDate = '2026-11-01';

    // Calculate month after target date
    const [year, month, day] = targetDate.split('-').map(Number);

    const nextMonthDate = new Date(
        Date.UTC(year, month, day)
    )
        .toISOString()
        .slice(0, 10);

    console.log(`Cleaning jobs for: ${targetDate}`);
    console.log(`Cleaning jobs for: ${nextMonthDate}`);

    const datesToClean = [
        targetDate,
        nextMonthDate,
    ];

    for (const scheduledDate of datesToClean) {
        // ============================================================
        // FIND JOBS
        // ============================================================

        const jobs = await queryDatabase(
            `
      SELECT *
      FROM core_engine.job_schedule
      WHERE scheduledate = $1
      `,
            [scheduledDate]
        );

        console.log(
            `Found ${jobs.length} job(s) for ${scheduledDate}`
        );

        // ============================================================
        // DELETE EACH JOB
        // ============================================================

        for (const job of jobs) {
            const jobId = job.id;

            console.log(`Deleting job ${jobId}...`);

            // Delete child rows first
            await queryDatabase(
                `
        DELETE FROM core_engine.job_schedule_list
        WHERE id = $1
        `,
                [jobId]
            );

            // Delete main job
            await queryDatabase(
                `
        DELETE FROM core_engine.job_schedule
        WHERE id = $1
        `,
                [jobId]
            );

            console.log(`PASS: Deleted job ${jobId}`);
        }

        // ============================================================
        // VERIFY CLEAN
        // ============================================================

        const remainingJobs = await queryDatabase(
            `
      SELECT *
      FROM core_engine.job_schedule
      WHERE scheduledate = $1
      `,
            [scheduledDate]
        );

        expect(
            remainingJobs.length,
            `Jobs still exist for ${scheduledDate}`
        ).toBe(0);

        console.log(
            `PASS: No jobs remain for ${scheduledDate}`
        );
    }
});