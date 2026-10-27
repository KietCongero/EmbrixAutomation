// Date arithmetic on YYYY-MM-DD strings, plus the expected collection calendar.
// Specs compute dates from the account's own bills, so none of this is hard-coded to 2042.

export const normalizeDate = (text: string) => {
    const match = text.match(/\d{4}-\d{2}-\d{2}/);
    if (!match) throw new Error(`Could not find date in: ${text}`);
    return match[0];
};

const format = (date: Date) =>
    `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];

export const addDays = (date: string, days: number) => {
    const [year, month, day] = parts(date);
    return format(new Date(Date.UTC(year, month - 1, day + days)));
};

export const addMonths = (date: string, months: number) => {
    const [year, month, day] = parts(date);
    return format(new Date(Date.UTC(year, month - 1 + months, day)));
};

export const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;

export const nextMonthFirst = (date: string) => firstOfMonth(addMonths(firstOfMonth(date), 1));

export const previousMonthFirst = (date: string) => firstOfMonth(addMonths(firstOfMonth(date), -1));

export const lastDayOfMonth = (date: string) => {
    const [year, month] = parts(date);
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export const endOfMonth = (date: string) => `${date.slice(0, 7)}-${String(lastDayOfMonth(date)).padStart(2, '0')}`;

export const dayOfMonth = (date: string) => parts(date)[2];

export const withDay = (date: string, day: number) => `${date.slice(0, 7)}-${String(day).padStart(2, '0')}`;

export const daysBetween = (startDate: string, endDate: string) => {
    const [sy, sm, sd] = parts(startDate);
    const [ey, em, ed] = parts(endDate);
    return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000);
};

// 0 = Sunday ... 6 = Saturday
export const weekday = (date: string) => {
    const [year, month, day] = parts(date);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

export const isWeekend = (date: string) => weekday(date) === 0 || weekday(date) === 6;

export const nextBusinessDay = (date: string) => {
    let result = date;
    while (isWeekend(result)) result = addDays(result, 1);
    return result;
};

// Every day from `from` to `to` inclusive - for "process the 18th to the 22nd" style steps.
export const eachDay = (from: string, to: string) => {
    const days: string[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) days.push(date);
    return days;
};

export const ordinal = (day: number) => {
    if (day >= 11 && day <= 13) return `${day}th`;
    if (day % 10 === 1) return `${day}st`;
    if (day % 10 === 2) return `${day}nd`;
    if (day % 10 === 3) return `${day}rd`;
    return `${day}th`;
};

export const moneyToCents = (text: string) => {
    const value = Number(text.replace(/,/g, '').replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${text}`);
    return Math.round(value * 100);
};

export const moneyToNumber = (text: string) => moneyToCents(text) / 100;

// ============================================================
// COLLECTION CALENDAR
// ============================================================
// Two rule sets exist on the sandbox:
//   legacy  - suspension at due date + 5 (next Monday if it falls on a weekend), cancellation
//             notice at suspension + 10. What TC-06 to TC-10 of 790115 observed.
//   eft102  - suspension on the 21st of the due month, even on a weekend; notice at
//             suspension + 1. What TC-16 to TC-21 expect after the ~Oct 19 2026 release.
// Pick with COLLECTION_RULE=legacy|eft102 (default eft102) or pass the rule explicitly.

export type CollectionRule = 'legacy' | 'eft102';

export const collectionRule = (): CollectionRule => {
    const rule = process.env.COLLECTION_RULE ?? 'eft102';
    if (rule !== 'legacy' && rule !== 'eft102') throw new Error(`Unknown COLLECTION_RULE "${rule}". Expected legacy or eft102.`);
    return rule;
};

export const expectedCollectionDates = (dueDate: string, rule: CollectionRule = collectionRule()) => {
    const entry = dueDate;
    const reminder = addDays(dueDate, 1);

    if (rule === 'legacy') {
        const suspension = nextBusinessDay(addDays(dueDate, 5));
        return { rule, entry, reminder, suspension, notice: addDays(suspension, 10) };
    }

    const suspension = withDay(dueDate, 21);
    return { rule, entry, reminder, suspension, notice: addDays(suspension, 1) };
};

// Cutoff-month billing (EFT-10): days used + 10 (legacy) or + 11 (option B), capped at the full month.
// Returns the number of billable days in the month the suspension happened.
export const cutoffMonthBillableDays = (suspensionDate: string, extraDays: 10 | 11 = 11) => {
    const daysUsed = dayOfMonth(suspensionDate) - 1;
    return Math.min(daysUsed + extraDays, lastDayOfMonth(suspensionDate));
};

// Reconnection proration (EFT-15): only days with service, the reconnection day counts.
export const reconnectionBillableDays = (reconnectionDate: string) => lastDayOfMonth(reconnectionDate) - dayOfMonth(reconnectionDate) + 1;
