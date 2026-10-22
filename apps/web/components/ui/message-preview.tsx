'use client';
import { useState, useRef, useEffect } from 'react';
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
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const fit = (frame: HTMLIFrameElement) => {
    observer.current?.disconnect();
    const body = frame.contentDocument?.body;
    if (!body) return;
    const resize = () => {
      frame.style.height =
        Math.max(120, Math.ceil(body.getBoundingClientRect().height + 32)) + 'px';
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      observer.current = new ResizeObserver(resize);
      observer.current.observe(body);
    }
  };
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
            sandbox="allow-same-origin"
            onLoad={(e) => fit(e.currentTarget)}
            scrolling="no"
            referrerPolicy="no-referrer"
            srcDoc={html}
            className={`mx-auto h-[620px] max-w-[600px] border-0 ${mode === 'mobile' ? 'w-[375px]' : 'w-full'}`}
          />
        )}
      </CardContent>
    </Card>
  );
}
