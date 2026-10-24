// @vitest-environment jsdom
import '@/test/dom';
import type { DefinitionCategory } from '@shapio/client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RemoteChangeBanner } from '.';

const renderBanner = (category: DefinitionCategory) =>
  render(
    <RemoteChangeBanner
      category={category}
      reason="remote"
      dirty={false}
      onReload={() => undefined}
      onKeepEdits={() => undefined}
    />,
  );

describe('RemoteChangeBanner', () => {
  it.each([
    ['model', 'This type changed in another session'],
    ['component', 'This component changed in another session'],
    ['interface', 'This interface changed in another session'],
  ] as const)('names what changed for a %s', (category, title) => {
    renderBanner(category);
    expect(screen.getByText(title)).toBeTruthy();
  });
});
