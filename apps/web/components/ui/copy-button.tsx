'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from './icon-button';

/** A small icon button that copies `value` and briefly shows a tick. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the text stays selectable on the page.
    }
  };
  return (
    <IconButton
      label={copied ? 'Copied' : label}
      variant="ghost"
      size="icon-sm"
      className="size-6"
      onClick={() => void copy()}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </IconButton>
  );
}
