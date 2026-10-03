import { describe, expect, it } from 'vitest';
import { autop } from './autop.js';

describe('autop', () => {
  it('turns blank lines into paragraphs and single newlines into breaks', () => {
    expect(autop('First line\nsecond line\n\nNext <em>para</em>')).toBe(
      '<p>First line<br />\nsecond line</p>\n<p>Next <em>para</em></p>',
    );
  });

  it('leaves block elements and preformatted text alone', () => {
    expect(autop('Intro\n<h2>Head</h2>\n<ul>\n<li>a</li>\n</ul>\n<pre>a\n\nb</pre>\nOutro')).toBe(
      '<p>Intro</p>\n<h2>Head</h2>\n<ul>\n<li>a</li>\n</ul>\n<pre>a\n\nb</pre>\n<p>Outro</p>',
    );
  });

  it('wraps text inside container blocks', () => {
    expect(autop('<blockquote>quoted\nline</blockquote>')).toBe(
      '<blockquote>\n<p>quoted<br />\nline</p>\n</blockquote>',
    );
  });

  it('returns block-editor content unchanged', () => {
    const html = '<!-- wp:paragraph -->\n<p>x</p>\n<!-- /wp:paragraph -->';
    expect(autop(html)).toBe(html);
  });
});
