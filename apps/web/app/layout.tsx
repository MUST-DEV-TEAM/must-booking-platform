import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';

import '@must/ui/styles.css';

const manrope = Manrope({
  display: 'swap',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'MUST Booking',
  description: 'MUST Booking tenant administration',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={manrope.className}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
