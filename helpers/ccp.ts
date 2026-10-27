import { expect, Page } from '@playwright/test';
import { env } from '../config/environments';

// Sandbox date (CCP time) through GraphiQL: R01 setCcpTime / R02 getCcpDateTime.
// setCcpTime moves the date only; nothing runs until the day's job schedule is processed (helpers/jobs.ts).

export const runGraphql = async (page: Page, query: string) => {
    await page.goto(env.graphiqlUrl);

    await page.evaluate((q) => {
        const codeMirror = (document.querySelector('.CodeMirror') as any)?.CodeMirror;

        if (!codeMirror) throw new Error('CodeMirror editor not found');

        codeMirror.setValue(q);
        codeMirror.focus();
    }, query);

    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Execute Query (Ctrl-Enter)' }).click();

    // Every CodeMirror after the query editor (variables, result); read their full text once a response arrives.
    const readResult = () =>
        page.evaluate(() =>
            [...document.querySelectorAll('.CodeMirror')]
                .slice(1)
                .map(editor => (editor as any).CodeMirror?.getValue() ?? '')
                .join('\n')
        );

    await expect.poll(readResult, { timeout: 15000 }).toContain('"data"');

    return readResult();
};

export const getCcpTime = async (page: Page) => {
    const result = await runGraphql(page, '{ getCcpDateTime(dummy: "") { ccpTime } }');
    const ccpTime = result.match(/"ccpTime": "(\d{4}-\d{2}-\d{2})/)?.[1];

    if (!ccpTime) throw new Error(`Could not read CCP time: ${result}`);

    console.log(`CCP time: ${ccpTime}`);

    return ccpTime;
};

export const setCcpTime = async (page: Page, targetDate: string, attempts = 3) => {
    console.log(`Changing CCP time to ${targetDate}...`);

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const result = await runGraphql(page, `mutation {
  setCcpTime(input: {
    ccpTime: "${targetDate}"
  }) {
    ccpTime
  }
}`);

        if (result.includes(`"ccpTime": "${targetDate}`)) {
            console.log(`PASS: CCP time changed to ${targetDate}`);
            return;
        }

        console.log(`WARNING: setCcpTime did not return ${targetDate} (attempt ${attempt}/${attempts})`);
        await page.waitForTimeout(2000);
    }

    throw new Error(`Could not set CCP time to ${targetDate}`);
};

// Moves the CCP time forward to `date` when it is still earlier. Never moves it back
// (other people share the sandbox and job schedules already processed cannot be re-run).
export const ensureCcpAtOrAfter = async (page: Page, date: string) => {
    const ccpTime = await getCcpTime(page);

    if (ccpTime >= date) {
        console.log(`PASS: CCP time ${ccpTime} already on or after ${date}`);
        return false;
    }

    await setCcpTime(page, date);
    return true;
};
