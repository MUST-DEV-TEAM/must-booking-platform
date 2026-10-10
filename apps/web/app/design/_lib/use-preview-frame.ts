'use client';

import { useEffect, useState } from 'react';

export function useIsPreviewFrame() {
  const [isPreviewFrame, setIsPreviewFrame] = useState(false);

  useEffect(() => {
    setIsPreviewFrame(new URLSearchParams(window.location.search).get('previewFrame') === '1');
  }, []);

  return isPreviewFrame;
}
