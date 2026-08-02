'use client';

import {
  type ButtonHTMLAttributes,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { LucideIcon } from 'lucide-react';

type ClassName = { className?: string };

function classNames(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> &
    ClassName & {
      variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    }
>(function Button({ className, variant = 'primary', ...props }, ref) {
  return (
    <button
      className={classNames('must-button', `must-button--${variant}`, className)}
      ref={ref}
      {...props}
    />
  );
});

export function TextInput({
  className,
  label,
  error,
  hint,
  id: suppliedId,
  startAdornment,
  endAdornment,
  'aria-describedby': suppliedDescribedBy,
  'aria-invalid': suppliedInvalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> &
  ClassName & {
    label: string;
    error?: string;
    hint?: string;
    startAdornment?: ReactNode;
    endAdornment?: ReactNode;
  }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [suppliedDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <label className="must-field" htmlFor={id}>
      <span className="must-field__label">{label}</span>
      <span className="must-input-wrap">
        {startAdornment ? (
          <span aria-hidden="true" className="must-input__adornment must-input__adornment--start">
            {startAdornment}
          </span>
        ) : null}
        <input
          {...props}
          aria-describedby={describedBy}
          aria-invalid={error ? true : suppliedInvalid}
          className={classNames(
            'must-input',
            startAdornment ? 'must-input--with-start' : undefined,
            endAdornment ? 'must-input--with-end' : undefined,
            error && 'must-input--error',
            className,
          )}
          id={id}
        />
        {endAdornment ? (
          <span className="must-input__adornment must-input__adornment--end">{endAdornment}</span>
        ) : null}
      </span>
      {hint ? (
        <span className="must-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="must-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function Card({ className, children }: ClassName & { children: ReactNode }) {
  return <section className={classNames('must-card', className)}>{children}</section>;
}

export function Alert({
  className,
  children,
  id,
  tone = 'info',
  role,
}: ClassName & {
  children: ReactNode;
  id?: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  role?: 'status' | 'alert';
}) {
  return (
    <div
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      className={classNames('must-alert', `must-alert--${tone}`, className)}
      id={id}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
    >
      {children}
    </div>
  );
}

export function Badge({
  className,
  children,
  tone = 'neutral',
}: ClassName & { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  return (
    <span className={classNames('must-badge', `must-badge--${tone}`, className)}>{children}</span>
  );
}

export function Stack({
  className,
  children,
  gap = 'md',
}: ClassName & { children: ReactNode; gap?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={classNames('must-stack', `must-stack--${gap}`, className)}>{children}</div>
  );
}

export type NavigationItem = { href: string; label: string; current?: boolean; icon?: LucideIcon };

function NavigationLinks({
  items,
  onNavigate,
}: {
  items: readonly NavigationItem[];
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main navigation" className="must-navigation-links">
      {items.map((item) => (
        <a
          aria-current={item.current ? 'page' : undefined}
          href={item.href}
          key={item.href}
          onClick={onNavigate}
        >
          {item.icon ? <item.icon aria-hidden="true" size={18} strokeWidth={2} /> : null}
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function SidebarNavigation({
  items,
  className,
  userEmail,
  homeHref = '/platform',
}: {
  items: readonly NavigationItem[];
  userEmail?: string;
  homeHref?: string;
} & ClassName) {
  return (
    <aside className={classNames('must-sidebar-navigation', className)}>
      <a className="must-shell-brand" href={homeHref} aria-label="MUST Hotel home">
        <img alt="" src="/auth/portal-m-mark.svg" />
        <span>MUST Hotel</span>
      </a>
      <NavigationLinks items={items} />
      <div className="must-shell-profile">
        <span className="must-shell-profile__email">{userEmail ?? 'Signed-in user'}</span>
        <a href="/login?reason=logout-confirmation">Log out</a>
      </div>
    </aside>
  );
}

export function Heading({
  className,
  children,
  id,
  level = 1,
}: ClassName & { children: ReactNode; id?: string; level?: 1 | 2 | 3 }) {
  const Tag = `h${level}` as const satisfies keyof HTMLElementTagNameMap;
  return (
    <Tag className={classNames('must-heading', `must-heading--${level}`, className)} id={id}>
      {children}
    </Tag>
  );
}

export function Text({
  className,
  children,
  tone = 'primary',
}: ClassName & { children: ReactNode; tone?: 'primary' | 'secondary' }) {
  return <p className={classNames('must-text', `must-text--${tone}`, className)}>{children}</p>;
}

/** Mobile/tablet navigation. It replaces the desktop sidebar below the 1024px desktop breakpoint. */
export function MobileDrawerNavigation({
  items,
  title = 'Navigation',
}: {
  items: readonly NavigationItem[];
  title?: string;
}) {
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    firstLinkRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) triggerRef.current?.focus();
  }, [open]);

  return (
    <div className="must-mobile-navigation">
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
        variant="ghost"
      >
        Menu
      </Button>
      {open ? (
        <div className="must-drawer-backdrop" onMouseDown={() => setOpen(false)}>
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className="must-drawer"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="must-drawer__header">
              <h2 id={titleId}>{title}</h2>
              <Button
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                type="button"
                variant="ghost"
              >
                Close
              </Button>
            </div>
            <nav aria-label="Main navigation" className="must-navigation-links">
              {items.map((item, index) => (
                <a
                  aria-current={item.current ? 'page' : undefined}
                  href={item.href}
                  key={item.href}
                  onClick={() => setOpen(false)}
                  ref={index === 0 ? firstLinkRef : undefined}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Top-level dashboard layout: desktop sidebar (hidden below 1024px) plus mobile drawer nav (shown
 * below 1024px), wrapping a scrollable content area. One composition point for every dashboard
 * screen rather than each page re-deriving the responsive nav split.
 */
export function AppShell({
  navigation,
  title,
  userEmail,
  homeHref,
  children,
}: {
  navigation: readonly NavigationItem[];
  title: string;
  userEmail?: string;
  homeHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="must-app-shell">
      <SidebarNavigation
        className="must-app-shell__sidebar"
        homeHref={homeHref}
        items={navigation}
        userEmail={userEmail}
      />
      <div className="must-app-shell__main">
        <header className="must-app-shell__header">
          <MobileDrawerNavigation items={navigation} title={title} />
          <div className="must-desktop-header">
            <Heading level={2}>{title}</Heading>
            <div className="must-desktop-header__profile">
              <span>{userEmail ?? 'Signed-in user'}</span>
              <a href="/login?reason=logout-confirmation">Log out</a>
            </div>
          </div>
        </header>
        <main className="must-app-shell__content">{children}</main>
      </div>
    </div>
  );
}
