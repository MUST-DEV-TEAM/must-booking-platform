import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

import Home from './page';
import { redirect } from 'next/navigation';

describe('Home page', () => {
  it('redirects visitors to login', () => {
    Home();

    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
