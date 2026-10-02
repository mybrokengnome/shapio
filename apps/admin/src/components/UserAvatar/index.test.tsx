import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UserAvatar } from '.';

describe('UserAvatar', () => {
  it('shows the initials, sized, and stays out of the accessibility tree', () => {
    const html = renderToStaticMarkup(<UserAvatar name="Ada Lovelace" size="sm" />);
    expect(html).toContain('>AL<');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-size="sm"');
  });
});
