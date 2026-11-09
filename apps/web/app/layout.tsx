import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import 'react-day-picker/style.css';

import '@must/ui/styles.css';

// Bundled instead of fetched from Google Fonts at build time, which failed the build intermittently.
const manrope = localFont({
  src: './fonts/manrope-latin-wght-normal.woff2',
  display: 'swap',
  weight: '200 800',
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
