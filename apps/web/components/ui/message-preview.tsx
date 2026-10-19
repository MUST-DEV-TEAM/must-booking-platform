'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { TabBar } from './tab-bar';
/** Sandboxed HTML and plain-text preview for structured messages, with responsive width. */
export function MessagePreview({
  subject,
  html,
  text,
}: {
  subject: string;
  html: string;
  text: string;
}) {
  const [mode, setMode] = useState('desktop');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{subject}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TabBar
          label="Preview format"
          tabs={[
            { id: 'desktop', label: 'Desktop' },
            { id: 'mobile', label: 'Mobile' },
            { id: 'text', label: 'Plain text' },
          ]}
          current={mode}
          onSelect={setMode}
        />
        {mode === 'text' ? (
          <pre className="m-0 whitespace-pre-wrap break-words text-sm">{text}</pre>
        ) : (
          <iframe
            title="Message preview"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={html}
            className={`mx-auto h-[620px] max-w-full border-0 ${mode === 'mobile' ? 'w-[375px]' : 'w-full'}`}
          />
        )}
      </CardContent>
    </Card>
  );
}
