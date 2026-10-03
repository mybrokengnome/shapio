// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shapioAttr } from './attributes.js';
import { initVisualEditing } from './visualEditing.js';

const ID = '3f1c2b9a-8d7e-4f60-9a1b-2c3d4e5f6a7b';
const SHAPIO = 'https://cms.example.com';

type Listener = (event: Partial<MessageEvent>) => void;

/** A window seen from inside a frame: its own document and location, a separate top and parent. */
const framedWindow = (search = '?shapio-visual=1', framed = true) => {
  window.history.replaceState(null, '', `/preview/${search}`);
  document.body.innerHTML = '';
  const listeners = new Set<Listener>();
  const parent = { postMessage: vi.fn() };
  const self = {};
  const reload = vi.fn();
  const win = {
    self,
    top: framed ? {} : self,
    parent,
    document,
    location: { href: window.location.href, reload },
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  const send = (event: Partial<MessageEvent>) => listeners.forEach((listener) => listener(event));
  return { win: win as unknown as Window, parent, reload, send, listeners };
};

const addTitle = () => {
  const title = document.createElement('a');
  title.href = '/elsewhere';
  title.textContent = 'Hello';
  for (const [name, value] of Object.entries(shapioAttr({ id: ID, locale: 'en' }, 'title'))) {
    title.setAttribute(name, value);
  }
  const inner = document.createElement('span');
  title.append(inner);
  document.body.append(title);
  return { title, inner };
};

let stop: () => void = () => undefined;
afterEach(() => stop());

describe('initVisualEditing', () => {
  it('does nothing outside a frame or without ?shapio-visual=1', () => {
    for (const setup of [framedWindow('?shapio-visual=1', false), framedWindow('')]) {
      stop = initVisualEditing({ origin: SHAPIO, window: setup.win });
      expect(setup.parent.postMessage).not.toHaveBeenCalled();
      expect(setup.listeners.size).toBe(0);
    }
  });

  it('announces itself to the configured origin only', () => {
    const { win, parent } = framedWindow();
    stop = initVisualEditing({ origin: `${SHAPIO}/cms/`, window: win });
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'shapio:ready', v: 1 }, SHAPIO);
  });

  it('posts the clicked field to the parent and keeps the link from navigating', () => {
    const { win, parent } = framedWindow();
    stop = initVisualEditing({ origin: SHAPIO, window: win });
    const { inner } = addTitle();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    inner.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      { type: 'shapio:focus', v: 1, entryId: ID, path: 'title', locale: 'en' },
      SHAPIO,
    );
  });

  it('outlines the annotated element under the pointer', () => {
    const { win } = framedWindow();
    stop = initVisualEditing({ origin: SHAPIO, window: win });
    const { title, inner } = addTitle();
    inner.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(title.hasAttribute('data-shapio-hover')).toBe(true);
    stop();
    expect(title.hasAttribute('data-shapio-hover')).toBe(false);
    expect(document.documentElement.hasAttribute('data-shapio-visual')).toBe(false);
  });

  it('refreshes only on a refresh message from the parent window and the configured origin', async () => {
    const { win, parent, send, reload } = framedWindow();
    const onRefresh = vi.fn();
    stop = initVisualEditing({ origin: SHAPIO, window: win, onRefresh });
    const refresh = { type: 'shapio:refresh', v: 1 };
    send({ source: parent as unknown as Window, origin: 'https://evil.example', data: refresh });
    send({ source: {} as Window, origin: SHAPIO, data: refresh });
    send({ source: parent as unknown as Window, origin: SHAPIO, data: { type: 'shapio:focus', v: 1 } });
    await Promise.resolve();
    expect(onRefresh).not.toHaveBeenCalled();
    send({ source: parent as unknown as Window, origin: SHAPIO, data: refresh });
    await Promise.resolve();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page when the site gives no refresh hook', () => {
    const { win, parent, send, reload } = framedWindow();
    stop = initVisualEditing({ origin: SHAPIO, window: win });
    send({ source: parent as unknown as Window, origin: SHAPIO, data: { type: 'shapio:refresh', v: 1 } });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('refuses an origin that is not http(s)', () => {
    const { win, parent } = framedWindow();
    stop = initVisualEditing({ origin: 'javascript:alert(1)', window: win });
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});
