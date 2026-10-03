import { initVisualEditing } from './visualEditing.js';

/**
 * The plain-script build (`window.ShapioVisual`). A `<script>` tag with `data-shapio-origin` turns visual editing
 * on by itself (the page reloads on refresh); otherwise call `ShapioVisual.initVisualEditing({ origin })`.
 */
const script = document.currentScript;
const origin = script instanceof HTMLScriptElement ? script.dataset.shapioOrigin : undefined;
if (origin) {
  initVisualEditing({ origin });
}

export { shapioAttr } from './attributes.js';
export { initVisualEditing };
