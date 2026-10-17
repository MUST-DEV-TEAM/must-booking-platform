'use client';

import { Check, Copy, Eye, EyeOff, WandSparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from './button';
import { Input } from './input';

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';
const ALPHABET = LETTERS + DIGITS + SYMBOLS;

function randomBelow(max: number): number {
  const limit = 256 - (256 % max);
  const bytes = new Uint8Array(32);
  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) if (byte < limit) return byte % max;
  }
}

function randomCharacter(characters: string): string {
  return characters[randomBelow(characters.length)]!;
}

function generateStrongPassword(): string {
  const characters = [
    randomCharacter(LETTERS),
    randomCharacter(DIGITS),
    randomCharacter(SYMBOLS),
    ...Array.from({ length: 13 }, () => randomCharacter(ALPHABET)),
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomBelow(index + 1);
    [characters[index], characters[swap]] = [characters[swap]!, characters[index]!];
  }
  return characters.join('');
}

function passwordStrength(value: string): string {
  if (value.length < 12 || !/[a-z]/i.test(value) || !/\d/.test(value)) return 'Weak';
  if (value.length >= 16 && /[^a-z0-9]/i.test(value)) return 'Strong';
  return 'Good';
}

/** A password input with reveal, secure generation, copy, and a simple strength hint. */
export function PasswordField({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const strength = passwordStrength(value);

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setStatus('Password copied.');
    } catch {
      setCopied(false);
      setStatus('Could not copy the password.');
    }
  };

  const generatePassword = () => {
    try {
      onChange(generateStrongPassword());
      setCopied(false);
      setStatus('Strong password generated.');
    } catch {
      setStatus('Could not generate a password on this device.');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          aria-label="Password"
          autoComplete="new-password"
          type={visible ? 'text' : 'password'}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            setCopied(false);
            setStatus('');
            onChange(event.target.value);
          }}
          className="min-w-48 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Copy password"
          disabled={disabled || !value}
          onClick={() => void copyPassword()}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-xs text-muted-foreground" aria-live="polite">
          Password strength: <span className="font-semibold">{strength}</span>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={generatePassword}
        >
          <WandSparkles aria-hidden="true" /> Generate strong password
        </Button>
      </div>
      {status ? (
        <p role="status" className="m-0 text-xs text-muted-foreground">
          {status}
        </p>
      ) : null}
    </div>
  );
}
