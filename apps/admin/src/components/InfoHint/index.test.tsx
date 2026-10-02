import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@/app/i18n';
import { InfoHint } from '.';

beforeAll(async () => {
  await initI18n();
});

describe('InfoHint', () => {
  it('names its button after what it explains', () => {
    const html = renderToStaticMarkup(<InfoHint about="API ID">Used in URLs.</InfoHint>);
    expect(html).toContain('aria-label="More about API ID"');
  });

  it('renders the hint text under the given id, for the control’s aria-describedby', () => {
    const html = renderToStaticMarkup(
      <InfoHint about="API ID" id="field-apiKey-hint">
        Used in URLs.
      </InfoHint>,
    );
    expect(html).toContain('<span id="field-apiKey-hint" class="sr-only">Used in URLs.</span>');
  });
});
