'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './confirm-dialog';
const Context = createContext<{
  setDirty: (dirty: boolean) => void;
  request: (action: () => void) => void;
  clean: () => void;
}>({ setDirty: () => {}, request: (action) => action(), clean: () => {} });
/** Shared guard for editor navigation, links and browser close; never discards without confirmation. */
export function UnsavedChangesBoundary({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false),
    [pending, setPending] = useState<(() => void) | null>(null),
    dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const request = (action: () => void) => (dirtyRef.current ? setPending(() => action) : action());
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const link = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !dirtyRef.current ||
        !anchor ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        anchor.getAttribute('target') === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const href = (anchor as HTMLAnchorElement).href;
      if (!href || href === window.location.href || !/^https?:/.test(href)) return;
      const destination = new URL(href),
        current = new URL(window.location.href);
      // Skip links and in-page anchors retain the editor. Do not offer to discard its draft.
      if (
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        (destination.hash || href.endsWith('#'))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPending(() => () => window.location.assign(href));
    };
    window.addEventListener('beforeunload', before);
    document.addEventListener('click', link, true);
    return () => {
      window.removeEventListener('beforeunload', before);
      document.removeEventListener('click', link, true);
    };
  }, []);
  return (
    <Context.Provider
      value={{
        setDirty,
        request,
        clean: () => {
          dirtyRef.current = false;
          setDirty(false);
        },
      }}
    >
      {children}
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="Discard unsaved changes?"
        description="Your unsaved wording changes will be lost. Saved drafts are kept."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        destructive
        onConfirm={async () => {
          const action = pending;
          dirtyRef.current = false;
          setDirty(false);
          setPending(null);
          action?.();
        }}
      />
    </Context.Provider>
  );
}
export function useUnsavedNavigation() {
  return useContext(Context);
}
export function useUnsavedChanges(dirty: boolean) {
  const { setDirty, clean } = useContext(Context);
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  return clean;
}
