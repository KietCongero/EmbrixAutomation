import { test, expect } from '@playwright/test';
import { env } from '../config/environments';

test('billing flow', async ({ page }) => {
  const username = env.username;
  const password = env.password;

  if (!username || !password) {
    throw new Error('Missing EMBRIX_USERNAME or EMBRIX_PASSWORD');
  }

  await page.goto('/login');

  await page
    .getByRole('textbox', { name: 'Username' })
    .fill(username);

  await page
    .getByRole('textbox', { name: 'Password' })
    .fill(password);

  await page
    .getByRole('button', { name: 'Login' })
    .click();

  await expect(page).toHaveURL(/\/dashboard\/me\/?$/);

  console.log('Login successful');

  // Start adding/recording the billing steps from here
  await page.pause();
});