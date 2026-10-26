/** Query strings may contain signed guest capabilities or personal search terms. */
export function requestLogPath(url?: string): string | undefined {
  if (!url) return url;
  const path = url.split('?')[0];
  return path.startsWith('/media/upload/') ? '/media/upload/[redacted]' : path;
}
