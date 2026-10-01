/** WCAG 2.x contrast ratio between two hex colors; NaN when either value is not a hex color. */
export function contrastRatio(foreground: string, background: string): number {
  const normalize = (value: string) => {
    const hex = value.trim();
    // Computed custom properties can come back as #fff, so expand 3-digit hex first.
    return /^#[0-9a-fA-F]{3}$/.test(hex)
      ? `#${hex
          .slice(1)
          .split('')
          .map((char) => char + char)
          .join('')}`
      : hex;
  };
  const fg = normalize(foreground);
  const bg = normalize(background);
  const isHex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);
  if (!isHex(fg) || !isHex(bg)) return Number.NaN;

  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export const AA_NORMAL_TEXT = 4.5;
