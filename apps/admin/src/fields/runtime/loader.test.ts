import { EDITOR_CONTRACT_VERSION } from '@shapio/editor-sdk';
import { describe, expect, it, vi } from 'vitest';
import { editorModuleUrl, loadRuntimeEditors } from './loader';

vi.mock('@/api/client', () => ({ apiBaseUrl: () => 'https://cms.test/cms/' }));

const editor = (id: string, contractVersion = EDITOR_CONTRACT_VERSION) => ({
  id,
  contractVersion,
  dataTypes: ['integer'],
  component: () => null,
});

describe('loadRuntimeEditors', () => {
  it('registers every editor export and reports modules it cannot use', async () => {
    const modules: Record<string, Record<string, unknown>> = {
      'https://cms.test/cms/api/admin/extensions/editors/rating.js?v=1': {
        editor: editor('acme.rating'),
        helper: 1,
      },
      'https://cms.test/cms/api/admin/extensions/editors/old.js?v=1': { editor: editor('acme.old', 0) },
      'https://cms.test/cms/api/admin/extensions/editors/empty.js?v=1': { nothing: true },
      'https://cms.test/cms/api/admin/extensions/editors/twin.js?v=1': { editor: editor('acme.rating') },
    };
    const manifest = {
      items: ['rating', 'old', 'empty', 'twin', 'broken'].map((name) => ({
        file: `${name}.js`,
        hash: '1',
        path: `/api/admin/extensions/editors/${name}.js?v=1`,
      })),
    };
    const result = await loadRuntimeEditors(manifest, async (url) => {
      const found = modules[url];
      if (!found) {
        throw new Error(`404 ${url}`);
      }
      return found;
    });
    expect([...result.editors.keys()]).toEqual(['acme.rating']);
    expect(result.problems.map(({ file, reason }) => [file, reason])).toEqual([
      ['old.js', 'contractVersion'],
      ['empty.js', 'noEditor'],
      ['twin.js', 'duplicateId'],
      ['broken.js', 'importFailed'],
    ]);
  });

  it('resolves module paths against the server base URL (BASE_PATH included)', () => {
    expect(editorModuleUrl('/api/admin/extensions/editors/a.js?v=2')).toBe(
      'https://cms.test/cms/api/admin/extensions/editors/a.js?v=2',
    );
  });
});
