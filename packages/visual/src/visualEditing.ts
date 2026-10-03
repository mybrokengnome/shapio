import { ENTRY_ATTRIBUTE, LOCALE_ATTRIBUTE, PATH_ATTRIBUTE } from './attributes.js';
import {
  parseAdminMessage,
  VISUAL_PROTOCOL_VERSION,
  VISUAL_QUERY_PARAM,
  type SiteMessage,
} from './messages.js';

export type VisualEditingOptions = {
  /** Shapio's public URL (or origin). Messages go to this origin only, and only its messages are accepted. */
  origin: string;
  /**
   * Re-renders the page with the current draft after an edit. Without it the page reloads, which is right for a
   * page that reads its preview token from the URL on every load; a page that drops the token from the address
   * bar must re-fetch here instead.
   */
  onRefresh?: () => void | Promise<void>;
  /** The window to run in (tests); defaults to the global one. */
  window?: Window;
};

/** The attribute on `<html>` while visual editing is on, and on the element under the pointer. */
const ACTIVE_DOCUMENT_ATTRIBUTE = 'data-shapio-visual';
const HOVER_ATTRIBUTE = 'data-shapio-hover';
const STYLE = `[${ACTIVE_DOCUMENT_ATTRIBUTE}] [${HOVER_ATTRIBUTE}] { outline: 2px dashed #2563eb; outline-offset: 2px; cursor: pointer; }`;

const NOOP = () => undefined;

/** Visual editing runs only inside a frame, on a URL the admin opened with `?shapio-visual=1`. */
export const isVisualEditingRequested = (win: Window): boolean => {
  let framed: boolean;
  try {
    framed = win.self !== win.top;
  } catch {
    // A cross-origin top window can throw on access in some browsers: that is a frame.
    framed = true;
  }
  return framed && new URL(win.location.href).searchParams.get(VISUAL_QUERY_PARAM) === '1';
};

const originOf = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

const annotatedFrom = (target: EventTarget | null): HTMLElement | null => {
  const element = target as Element | null;
  return typeof element?.closest === 'function' ? element.closest<HTMLElement>(`[${ENTRY_ATTRIBUTE}]`) : null;
};

/**
 * Turns on visual editing when the page is in Shapio's preview frame: outlines elements carrying
 * `shapioAttr(...)` attributes on hover, tells the admin which field was clicked, and re-renders when the admin
 * saves. Posts only to the configured Shapio origin and accepts only that origin's messages from the parent
 * window. Outside the preview frame it does nothing. Returns a function that turns it off.
 */
export const initVisualEditing = (options: VisualEditingOptions): (() => void) => {
  const win = options.window ?? window;
  const origin = originOf(options.origin);
  if (!origin || !isVisualEditingRequested(win)) {
    return NOOP;
  }
  const doc = win.document;
  const post = (message: SiteMessage) => win.parent.postMessage(message, origin);
  let hovered: HTMLElement | null = null;

  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.append(style);
  doc.documentElement.setAttribute(ACTIVE_DOCUMENT_ATTRIBUTE, '');

  const onPointerOver = (event: Event) => {
    const element = annotatedFrom(event.target);
    if (element === hovered) {
      return;
    }
    hovered?.removeAttribute(HOVER_ATTRIBUTE);
    hovered = element;
    hovered?.setAttribute(HOVER_ATTRIBUTE, '');
  };
  const onClick = (event: Event) => {
    const element = annotatedFrom(event.target);
    const entryId = element?.getAttribute(ENTRY_ATTRIBUTE);
    const path = element?.getAttribute(PATH_ATTRIBUTE);
    if (!element || !entryId || !path) {
      return;
    }
    // A click on an annotated link or button edits the field instead of navigating inside the frame.
    event.preventDefault();
    event.stopPropagation();
    const locale = element.getAttribute(LOCALE_ATTRIBUTE);
    post({
      type: 'shapio:focus',
      v: VISUAL_PROTOCOL_VERSION,
      entryId,
      path,
      ...(locale ? { locale } : {}),
    });
  };
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent || event.origin !== origin || !parseAdminMessage(event.data)) {
      return;
    }
    if (options.onRefresh) {
      // A failing re-render surfaces as an unhandled rejection in the site's console, like any page error.
      void Promise.resolve().then(options.onRefresh);
    } else {
      win.location.reload();
    }
  };

  doc.addEventListener('pointerover', onPointerOver);
  doc.addEventListener('click', onClick, true);
  win.addEventListener('message', onMessage);
  post({ type: 'shapio:ready', v: VISUAL_PROTOCOL_VERSION });

  return () => {
    doc.removeEventListener('pointerover', onPointerOver);
    doc.removeEventListener('click', onClick, true);
    win.removeEventListener('message', onMessage);
    hovered?.removeAttribute(HOVER_ATTRIBUTE);
    doc.documentElement.removeAttribute(ACTIVE_DOCUMENT_ATTRIBUTE);
    style.remove();
  };
};
