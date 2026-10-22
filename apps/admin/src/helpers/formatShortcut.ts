type NavigatorWithUserAgentData = Pick<Navigator, 'platform' | 'userAgent'> & {
  userAgentData?: { platform?: string };
};

const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

/** Mac symbols for the modifiers ("Mod+Shift+8" → "⌘⇧8"). */
const APPLE_KEYS: Readonly<Record<string, string>> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃' };
/** Spelled-out modifiers elsewhere ("Mod+Shift+8" → "Ctrl+Shift+8"). */
const OTHER_KEYS: Readonly<Record<string, string>> = { Mod: 'Ctrl' };

const currentNavigator = (): NavigatorWithUserAgentData | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator;

/** Whether the admin runs on an Apple platform, where the shortcut modifier is ⌘ instead of Ctrl. */
export const isApplePlatform = (nav: NavigatorWithUserAgentData | undefined = currentNavigator()) => {
  if (!nav) {
    return false;
  }
  return APPLE_PLATFORM.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
};

/**
 * A shortcut written as Tiptap/ProseMirror keys ("Mod+Shift+8", "Mod+/") in the platform's own words: "⌘⇧8"
 * on Apple platforms, "Ctrl+Shift+8" elsewhere. Every shortcut the admin shows goes through this.
 */
export const formatShortcut = (keys: string, apple: boolean = isApplePlatform()) => {
  const parts = keys.split('+');
  return apple
    ? parts.map((part) => APPLE_KEYS[part] ?? part).join('')
    : parts.map((part) => OTHER_KEYS[part] ?? part).join('+');
};
