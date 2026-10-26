import sanitizeHtml from 'sanitize-html';

const removeLinks = (text: string) =>
  text.replace(/(?:https?|ftp):\/\/[^\s<>"']+|mailto:[^\s<>"']+/gi, '[link removed]');
/** A retained admin preview has no guest-action URL, remote resource or executable markup. */
export function safeEmailPreview(message: { subject: string; html: string; text: string }) {
  const html = sanitizeHtml(message.html, {
    allowedTags: [
      'div',
      'span',
      'p',
      'br',
      'hr',
      'h1',
      'h2',
      'h3',
      'h4',
      'strong',
      'b',
      'em',
      'i',
      'small',
      'blockquote',
      'pre',
      'ul',
      'ol',
      'li',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      'caption',
    ],
    transformTags: {
      a: (_tag, attributes) => ({ tagName: 'span', attribs: { style: attributes.style || '' } }),
    },
    allowedAttributes: {
      '*': ['style'],
      td: ['colspan', 'rowspan', 'style'],
      th: ['colspan', 'rowspan', 'style'],
    },
    nonTextTags: [
      'head',
      'title',
      'script',
      'style',
      'textarea',
      'option',
      'noscript',
      'iframe',
      'object',
      'svg',
      'math',
      'template',
    ],
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,8}$/i, /^(?:black|white|transparent)$/i],
        'background-color': [/^#[0-9a-f]{3,8}$/i, /^(?:black|white|transparent)$/i],
        'font-family': [/^[a-z,\s'"-]+$/i],
        'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        'font-weight': [/^(?:[1-9]00|normal|bold)$/],
        'line-height': [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/],
        'text-align': [/^(?:left|right|center)$/],
        'vertical-align': [/^(?:top|middle|bottom)$/],
        width: [/^(?:\d+(?:\.\d+)?(?:px|%)|auto)$/],
        'max-width': [/^(?:\d+(?:\.\d+)?(?:px|%)|auto)$/],
        padding: [/^[\d.]+(?:px|em|rem|%)?(?:\s+[\d.]+(?:px|em|rem|%)?){0,3}$/],
        margin: [/^[\d.]+(?:px|em|rem|%)?(?:\s+(?:[\d.]+(?:px|em|rem|%)?|auto)){0,3}$/],
        border: [/^\d+(?:\.\d+)?px (?:solid|dashed|dotted) #[0-9a-f]{3,8}$/i],
        'border-radius': [/^\d+(?:px|%)$/],
        'border-collapse': [/^(?:collapse|separate)$/],
        display: [/^(?:none|block|inline|inline-block|table|table-row|table-cell)$/],
      },
    },
  });
  return {
    subject: removeLinks(message.subject),
    text: removeLinks(message.text),
    html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"></head><body>${removeLinks(html)}</body></html>`,
  };
}
