import { expect, test } from '@playwright/test';
import { openApp } from './planner-helpers';

test.use({ timezoneId: 'America/Chicago', locale: 'en-US' });
for (const width of [1440, 390]) {
    test(`calendar keeps overlapping appointments and work readable at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.install({ time: new Date('2026-09-22T12:00:00Z') });
        const event = (id: string, start: string, end: string, title: string) => `BEGIN:VEVENT\r\nUID:${id}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:${title}\r\nLOCATION:Science Building Room 401\r\nEND:VEVENT`;
        const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${[
            event('a', '20260922T130000', '20260922T140000', 'Research discussion with a long descriptive meeting title'),
            event('b', '20260922T131500', '20260922T141500', 'Seminar'),
            event('short-a', '20260922T160000', '20260922T160500', 'Quick check-in'),
            event('short-b', '20260922T160500', '20260922T161000', 'Follow-up'),
            'BEGIN:VEVENT\r\nUID:all-day\r\nDTSTART;VALUE=DATE:20260922\r\nDTEND;VALUE=DATE:20260924\r\nSUMMARY:Conference day\r\nEND:VEVENT',
        ].join('\r\n')}\r\nEND:VCALENDAR`;
        await page.route('https://calendar.example.test/layout.ics', route => route.fulfill({ contentType: 'text/calendar', body: ics }));
        await page.addInitScript(() => localStorage.setItem('mindwtr-external-calendars', JSON.stringify([{ id: 'layout', name: 'University', enabled: true, url: 'https://calendar.example.test/layout.ics' }])));
        await openApp(page, [{ id: 'work', title: 'Write research notes', status: 'next', tags: [], contexts: [], createdAt: '2026-09-21T12:00:00Z', updatedAt: '2026-09-21T12:00:00Z', scheduledAt: '2026-09-22T18:30:00Z', timeEstimate: 'custom:60' }]);
        await page.getByTestId('workspace-actions').getByRole('button', { name: 'Calendar', exact: true }).click();
        await page.getByRole('button', { name: 'Day', exact: true }).click();
        const a = page.getByRole('button', { name: /Research discussion.*Science Building/ });
        const b = page.getByRole('button', { name: 'Seminar · Science Building Room 401', exact: true });
        const work = page.locator('[data-calendar-block]');
        await expect(a).toHaveCount(1);
        await a.scrollIntoViewIfNeeded();
        expect((await a.locator('span').first().boundingBox())!.height).toBeLessThanOrEqual(32);
        await page.screenshot({ path: testInfo.outputPath('calendar-day.png') });
        const bounds = await Promise.all([a, b, work].map(item => item.boundingBox()));
        for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) {
            const first = bounds[i]!, second = bounds[j]!;
            expect(first.x + first.width <= second.x + 1 || second.x + second.width <= first.x + 1).toBe(true);
        }
        const allDay = page.getByTestId('planner-all-day');
        await expect(allDay.getByRole('button', { name: 'Conference day', exact: true })).toHaveCount(1);
        await expect(page.getByTestId('planner-time-grid').getByRole('button', { name: 'Conference day', exact: true })).toHaveCount(0);
        const quick = await page.getByRole('button', { name: 'Quick check-in · Science Building Room 401', exact: true }).boundingBox();
        const next = await page.getByRole('button', { name: 'Follow-up · Science Building Room 401', exact: true }).boundingBox();
        expect(quick!.height).toBeGreaterThanOrEqual(44);
        expect(quick!.x + quick!.width <= next!.x + 1 || next!.x + next!.width <= quick!.x + 1).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const today = await page.getByRole('button', { name: 'Today', exact: true }).boundingBox();
        expect(today!.x + today!.width).toBeLessThanOrEqual(width);
        await b.click();
        await expect(page.getByRole('dialog', { name: 'Seminar', exact: true }).getByText('Science Building Room 401')).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
        await page.getByRole('button', { name: 'Week', exact: true }).click();
        await expect(allDay.getByRole('button', { name: 'Conference day', exact: true })).toHaveCount(2);
        await a.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('calendar-week.png') });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}
