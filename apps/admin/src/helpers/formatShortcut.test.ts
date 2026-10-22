import { describe, expect, it } from 'vitest';
import { formatShortcut, isApplePlatform } from './formatShortcut';

describe('formatShortcut', () => {
  it('uses the Mac symbols on Apple platforms', () => {
    expect(formatShortcut('Mod+B', true)).toBe('⌘B');
    expect(formatShortcut('Mod+Shift+8', true)).toBe('⌘⇧8');
    expect(formatShortcut('Mod+/', true)).toBe('⌘/');
    expect(formatShortcut('Mod+Alt+1', true)).toBe('⌘⌥1');
  });

  it('spells out Ctrl and Shift elsewhere', () => {
    expect(formatShortcut('Mod+B', false)).toBe('Ctrl+B');
    expect(formatShortcut('Mod+Shift+8', false)).toBe('Ctrl+Shift+8');
    expect(formatShortcut('Mod+]', false)).toBe('Ctrl+]');
    expect(formatShortcut('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
  });
});

describe('isApplePlatform', () => {
  const nav = (platform: string, userAgent = '', dataPlatform?: string) => ({
    platform,
    userAgent,
    ...(dataPlatform === undefined ? {} : { userAgentData: { platform: dataPlatform } }),
  });

  it('recognizes macOS, iPhone and iPad', () => {
    expect(isApplePlatform(nav('MacIntel'))).toBe(true);
    expect(isApplePlatform(nav('iPhone'))).toBe(true);
    expect(isApplePlatform(nav('iPad'))).toBe(true);
    expect(isApplePlatform(nav('', '', 'macOS'))).toBe(true);
  });

  it('is false on Windows, Linux and Android', () => {
    expect(isApplePlatform(nav('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows'))).toBe(false);
    expect(isApplePlatform(nav('Linux x86_64'))).toBe(false);
    expect(isApplePlatform(nav('', '', 'Android'))).toBe(false);
  });

  it('falls back to the user agent when the platform is empty', () => {
    expect(isApplePlatform(nav('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'))).toBe(true);
  });
});
