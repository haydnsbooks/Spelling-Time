import { expect, test, type Route } from '@playwright/test';

async function mockSheet(route: Route, responses: Record<string, unknown>) {
  const request = route.request();
  const action = request.method() === 'GET'
    ? new URL(request.url()).searchParams.get('action') || ''
    : String(request.postDataJSON().action || '');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(responses[action] || { ok: true })
  });
}

const sheetPattern = 'https://script.google.com/macros/**';

test('student sign-in loads class data and Back returns to role choice', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Student sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Student' }).click();
  const room = page.getByLabel('Room');
  await expect(room).toBeVisible();
  await room.selectOption({ label: 'Room 9' });
  await expect(page.getByLabel('Your name')).toContainText('Simon Sausages');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Room')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Teacher' })).toBeVisible();
  await expect(pageErrors).toEqual([]);
});

test('student signs in, opens a curriculum word, and reaches Ice Blocks', async ({ page }) => {
  await page.route(sheetPattern, route => mockSheet(route, {
    studentStatus: { ok: true, hasPassword: true },
    studentLogin: { ok: true },
    studentSync: { ok: true, stages: { 1: 2 }, activities: {} }
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Student' }).click();
  await page.getByLabel('Room').selectOption({ label: 'Room 9' });
  await page.getByLabel('Your name').selectOption({ label: 'Sunny Baensch' });
  await expect(page.getByLabel('Password')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Your name')).toHaveValue('');
  await page.getByLabel('Your name').selectOption({ label: 'Sunny Baensch' });
  await expect(page.getByLabel('Password')).toBeVisible();
  await page.getByLabel('Password').fill('classroom');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Learning' })).toBeVisible();
  await expect(page.getByText('Stage 2 · Term 1 · Week 1')).toBeVisible();
  await page.getByRole('button', { name: /Word list/ }).click();
  await expect(page.getByRole('heading', { name: 'Word list' })).toBeVisible();
  await page.getByRole('button', { name: 'make' }).first().click();
  await expect(page.getByRole('region', { name: 'make word information' })).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'Learning' }).click();
  await page.getByRole('button', { name: 'Bonus games' }).click();
  await page.getByRole('button', { name: /Ice Blocks/ }).click();
  await expect(page.getByRole('textbox', { name: 'Guess word' })).toBeVisible();
});

test('student can highlight selected phonic passage text and add a note', async ({ page }) => {
  await page.route(sheetPattern, route => mockSheet(route, {
    studentStatus: { ok: true, hasPassword: true },
    studentLogin: { ok: true },
    studentSync: { ok: true, stages: { 1: 2 }, activities: {} }
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Student' }).click();
  await page.getByLabel('Room').selectOption({ label: 'Room 9' });
  await page.getByLabel('Your name').selectOption({ label: 'Sunny Baensch' });
  await page.getByLabel('Password').fill('classroom');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: /Phonic passage/ }).click();
  const passage = page.locator('.passage-copy');
  await passage.evaluate(element => {
    const text = element.firstChild;
    if (!text) throw new Error('Passage text did not render.');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 9);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    text.parentElement?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Highlight selection' }).click();
  await page.getByRole('group', { name: 'Highlight colour' }).getByRole('button', { name: 'Mint' }).click();
  await page.getByLabel('Note').fill('Check this spelling pattern.');
  await page.getByRole('button', { name: 'Save highlight' }).click();
  await expect(page.getByText('Check this spelling pattern.')).toBeVisible();
});

test('teacher can open student stage management', async ({ page }) => {
  await page.route(sheetPattern, route => mockSheet(route, {
    teacherLogin: { ok: true },
    getStages: { ok: true, stages: [] },
    setStages: { ok: true }
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Teacher' }).click();
  await page.getByLabel('Room').selectOption({ label: 'Room 9' });
  await page.getByLabel('Teacher password').fill('teacher-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Teacher overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Assign student stages' }).click();
  await expect(page.getByRole('heading', { name: 'Student stages' })).toBeVisible();
  await expect(page.getByText('Sunny Baensch')).toBeVisible();
});

test('student sync falls back to older Apps Script actions', async ({ page }) => {
  await page.route(sheetPattern, route => mockSheet(route, {
    studentStatus: { ok: true, hasPassword: true },
    studentLogin: { ok: true },
    studentSync: { ok: false, error: 'Unknown action: studentSync' },
    getStages: { ok: true, stages: [{ classNumber: 1, stage: 2 }] },
    getActivities: { ok: true, terms: {} }
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Student' }).click();
  await page.getByLabel('Room').selectOption({ label: 'Room 9' });
  await page.getByLabel('Your name').selectOption({ label: 'Sunny Baensch' });
  await page.getByLabel('Password').fill('classroom');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Stage 2 · Term 1 · Week 1')).toBeVisible();
});
