// @vitest-environment jsdom
import { CircleAlert, CircleHelp, FileQuestion, LoaderCircle, LockKeyhole } from 'lucide-react';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StatePanel, type StatePanelProps, type StatePanelVariant } from './state-panel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const iconByVariant = {
  empty: <FileQuestion aria-hidden="true" />,
  error: <CircleAlert aria-hidden="true" />,
  loading: <LoaderCircle aria-hidden="true" />,
  'no-permission': <LockKeyhole aria-hidden="true" />,
  'not-available': <CircleHelp aria-hidden="true" />,
} satisfies Record<StatePanelVariant, React.ReactNode>;

const content = {
  body: 'Supporting state explanation.',
  title: 'State title',
} as const;

describe('StatePanel', () => {
  it.each(Object.keys(iconByVariant) as StatePanelVariant[])(
    'renders the %s variant',
    (variant) => {
      const markup = renderToStaticMarkup(
        <StatePanel
          {...content}
          action={variant === 'empty' ? <button type="button">Take action</button> : undefined}
          icon={iconByVariant[variant]}
          variant={variant}
        />,
      );

      expect(markup).toContain(`must-state-panel--${variant}`);
      expect(markup).toContain('State title');
      expect(markup).toContain('Supporting state explanation.');
    },
  );

  it('keeps an empty state action keyboard reachable', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onClick = vi.fn();

    await act(async () => {
      root.render(
        createElement(StatePanel, {
          ...content,
          action: createElement('button', { onClick, type: 'button' }, 'Take action'),
          icon: iconByVariant.empty,
          variant: 'empty',
        }),
      );
    });

    const action = container.querySelector('button');
    expect(action).not.toBeNull();
    action?.focus();
    expect(document.activeElement).toBe(action);

    await act(async () => {
      action?.click();
    });
    expect(onClick).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });

  it('announces loading and errors with the appropriate live-region semantics', () => {
    const loadingMarkup = renderToStaticMarkup(
      <StatePanel {...content} icon={iconByVariant.loading} variant="loading" />,
    );
    const errorMarkup = renderToStaticMarkup(
      <StatePanel {...content} icon={iconByVariant.error} variant="error" />,
    );

    expect(loadingMarkup).toContain('aria-busy="true"');
    expect(loadingMarkup).toContain('aria-live="polite"');
    expect(loadingMarkup).toContain('role="status"');
    expect(loadingMarkup.match(/class="must-skeleton"/g)).toHaveLength(3);
    expect(errorMarkup).toContain('aria-live="assertive"');
    expect(errorMarkup).toContain('role="alert"');
  });

  it('requires an action in the empty variant at the type level', () => {
    // @ts-expect-error Empty state panels must provide a way forward.
    const missingAction: StatePanelProps = {
      ...content,
      icon: iconByVariant.empty,
      variant: 'empty',
    };

    expect(missingAction).toBeDefined();
  });
});
