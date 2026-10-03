import { describe, expect, it } from 'vitest';
import {
  ALL_SITES,
  assignmentRowsSchema,
  nextAssignmentRow,
  toAssignmentRows,
  toAssignments,
} from './assignments';

describe('toAssignmentRows / toAssignments', () => {
  it('maps every-site assignments to the "All sites" row and back', () => {
    const rows = toAssignmentRows(
      [
        { roleId: 'editor', siteId: null },
        { roleId: 'viewer', siteId: 'blog' },
      ],
      'owner',
    );
    expect(rows).toEqual([
      { site: ALL_SITES, roleId: 'editor' },
      { site: 'blog', roleId: 'viewer' },
    ]);
    expect(toAssignments(rows)).toEqual([
      { roleId: 'editor', siteId: null },
      { roleId: 'viewer', siteId: 'blog' },
    ]);
  });

  it('keeps one role per site, the owner role first', () => {
    const rows = toAssignmentRows(
      [
        { roleId: 'editor', siteId: null },
        { roleId: 'owner', siteId: null },
        { roleId: 'viewer', siteId: 'blog' },
        { roleId: 'editor', siteId: 'blog' },
      ],
      'owner',
    );
    expect(rows).toEqual([
      { site: ALL_SITES, roleId: 'owner' },
      { site: 'blog', roleId: 'viewer' },
    ]);
  });
});

describe('assignmentRowsSchema', () => {
  const schema = assignmentRowsSchema('owner');
  const messages = (rows: unknown) => {
    const result = schema.safeParse(rows);
    return result.success ? [] : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  };

  it('accepts one row per site', () => {
    expect(
      messages([
        { site: ALL_SITES, roleId: 'owner' },
        { site: 'blog', roleId: 'editor' },
      ]),
    ).toEqual([]);
  });

  it('refuses a site named twice and the owner role on one site', () => {
    expect(
      messages([
        { site: 'blog', roleId: 'editor' },
        { site: 'blog', roleId: 'owner' },
      ]),
    ).toEqual([
      ['1.site', 'validation.siteTwice'],
      ['1.roleId', 'validation.ownerAllSites'],
    ]);
  });

  it('needs a role on each row', () => {
    expect(messages([{ site: ALL_SITES, roleId: '' }])).toEqual([['0.roleId', 'validation.selectRole']]);
  });
});

describe('nextAssignmentRow', () => {
  it('offers the first site no row uses yet', () => {
    expect(nextAssignmentRow([{ site: ALL_SITES, roleId: 'x' }], ['blog', 'shop'], 'editor')).toEqual({
      site: 'blog',
      roleId: 'editor',
    });
    expect(nextAssignmentRow([], ['blog'], 'editor')).toEqual({ site: ALL_SITES, roleId: 'editor' });
  });

  it('offers nothing once every site has a row', () => {
    expect(
      nextAssignmentRow(
        [
          { site: ALL_SITES, roleId: 'x' },
          { site: 'blog', roleId: 'y' },
        ],
        ['blog'],
        'editor',
      ),
    ).toBeUndefined();
  });
});
