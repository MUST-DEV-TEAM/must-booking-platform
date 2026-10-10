import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/design', useRouter: () => ({}) }));
vi.mock('./design.css', () => ({}));

import DesignLayout from './layout';

describe('Design layout access', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('skips the login check only in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(renderToStaticMarkup(<DesignLayout>child</DesignLayout>)).toContain('Design preview');
  });

  it.each(['production', 'test'])('keeps the platform login check in %s', (env) => {
    vi.stubEnv('NODE_ENV', env);
    const markup = renderToStaticMarkup(<DesignLayout>child</DesignLayout>);
    expect(markup).toContain('Checking your account access');
    expect(markup).not.toContain('Design preview');
  });
});
