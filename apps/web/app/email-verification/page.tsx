'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function EmailVerificationPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Verifying your email…');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setMessage('This verification link is invalid or has expired.');
      return;
    }
    void fetch('/api/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((response) => {
        if (!response.ok) {
          setMessage('This verification link is invalid or has expired.');
          return;
        }
        setMessage('Your email is verified. Redirecting to your dashboard…');
        router.replace('/dashboard');
      })
      .catch(() => setMessage('We could not verify your email. Please try the link again.'));
  }, [router]);

  return (
    <main>
      <p role="status">{message}</p>
    </main>
  );
}
