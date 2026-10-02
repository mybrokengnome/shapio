import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefinition, expectStatus, type EntryBody, type ModelBody } from './helpers/content.js';
import { createTestApp, type TestApp } from './helpers/createTestApp.js';
import { createRoleToken, schemaClient, type SchemaClient } from './helpers/schemaAdmin.js';
import { useTestDatabase } from './helpers/testDatabase.js';

type Issue = { path: string; code: string } & Record<string, unknown>;
type InvalidBody = { error: { code: string; details: { issues: Issue[] } } };

const CUSTOM_EDITOR = { id: 'acme.starRating', options: { stars: 8 } };
const RANGE = { min: 1, max: 5 };

/** Same field, three editors: a built-in one, the example custom editor, and the type's default. */
const RATING_FIELDS = {
  builtIn: { editor: { id: 'numberInput', options: {} } },
  custom: { editor: CUSTOM_EDITOR },
  defaultEditor: {},
} as const;
type RatingKey = keyof typeof RATING_FIELDS;
const RATING_KEYS = Object.keys(RATING_FIELDS) as RatingKey[];

const INVALID_VALUES: ReadonlyArray<{ value: unknown; why: string }> = [
  { value: 8, why: 'above the maximum (a value the custom editor offers)' },
  { value: 0, why: 'below the minimum' },
  { value: 2.5, why: 'not an integer' },
  { value: 'five', why: 'not a number' },
];

const withoutPath = ({ path: _path, ...issue }: Issue) => issue;

/**
 * Brief §10 "Custom editor uses the same server validation": validation belongs to the field, never to the
 * editor. The same invalid value is refused with the identical error whether the field is edited with a
 * built-in editor, the installed custom editor (examples/custom-editor's `acme.starRating`, offering 8 stars
 * on a field whose maximum is 5) or the default one, and switching a field's editor live changes nothing.
 */
describe('custom editors get exactly the server validation of their field', () => {
  const database = useTestDatabase();
  let projectDir: string;
  let testApp: TestApp;
  let admin: SchemaClient;
  let review: ModelBody;

  beforeAll(async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'shapio-custom-editor-'));
    mkdirSync(join(projectDir, 'extensions', 'editors'), { recursive: true });
    writeFileSync(
      join(projectDir, 'extensions', 'editors', 'star-rating.js'),
      'export const editor = { id: "acme.starRating" };\n',
    );
    writeFileSync(
      join(projectDir, 'shapio.config.js'),
      'export const config = { editors: ["star-rating.js"] };\n',
    );
    testApp = await createTestApp(database.current, { schemaListen: false, projectDir });
    admin = schemaClient(testApp.app, await createRoleToken(database.current.db));
    review = await createDefinition(admin, {
      kind: 'collection',
      apiKey: 'review',
      label: 'Review',
      fields: RATING_KEYS.map((apiKey) => ({
        apiKey,
        label: apiKey,
        type: 'integer',
        settings: RANGE,
        ...RATING_FIELDS[apiKey],
      })),
    });
  });
  afterAll(async () => {
    await testApp.app.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  const issuesFor = async (data: Record<string, unknown>) => {
    const response = await admin.post('/api/admin/content/review', { data });
    expect(response.statusCode, response.body).toBe(422);
    const body = response.json<InvalidBody>();
    expect(body.error.code).toBe('CONTENT_INVALID');
    return body.error.details.issues;
  };

  it('the custom editor is installed and chosen on its field', async () => {
    const manifest = expectStatus(await admin.get('/api/admin/extensions/editors'), 200).json<{
      items: Array<{ file: string }>;
    }>();
    expect(manifest.items.map((item) => item.file)).toEqual(['star-rating.js']);
    const custom = review.definition.fields.find((field) => field.apiKey === 'custom');
    expect(custom?.editor).toEqual(CUSTOM_EDITOR);
  });

  it.each(INVALID_VALUES)('refuses $value ($why) identically whatever the editor', async ({ value }) => {
    const perField = await Promise.all(RATING_KEYS.map((apiKey) => issuesFor({ [apiKey]: value })));
    for (const [index, apiKey] of RATING_KEYS.entries()) {
      expect(perField[index]?.map((issue) => issue.path)).toEqual([`/${apiKey}`]);
    }
    const [builtIn, ...others] = perField.map((issues) => issues.map(withoutPath));
    expect(builtIn?.[0]?.code).toEqual(expect.any(String));
    for (const issues of others) {
      expect(issues).toEqual(builtIn);
    }
  });

  it('accepts what the field allows and refuses the rest on update too', async () => {
    const entry = expectStatus(
      await admin.post('/api/admin/content/review', { data: { custom: 5, builtIn: 5 } }),
      201,
    ).json<EntryBody>();
    const update = await admin.put(`/api/admin/content/review/${entry.id}`, {
      expectedVersion: entry.version,
      data: { custom: 8, builtIn: 5 },
    });
    expect(update.statusCode).toBe(422);
    expect(update.json<InvalidBody>().error.details.issues).toEqual([
      expect.objectContaining({ path: '/custom', code: 'TOO_LARGE' }),
    ]);
  });

  it('switching a field to the custom editor live leaves its validation unchanged', async () => {
    const before = await issuesFor({ builtIn: 8 });
    const current = expectStatus(
      await admin.get(`/api/admin/models/${review.definition.id}`),
      200,
    ).json<ModelBody>();
    expectStatus(
      await admin.put(`/api/admin/models/${review.definition.id}`, {
        definition: {
          ...current.definition,
          fields: current.definition.fields.map((field) =>
            field.apiKey === 'builtIn' ? { ...field, editor: CUSTOM_EDITOR } : field,
          ),
        },
        expectedVersion: current.version,
      }),
      200,
    );
    expect(await issuesFor({ builtIn: 8 })).toEqual(before);
    expect((await admin.post('/api/admin/content/review', { data: { builtIn: 3 } })).statusCode).toBe(201);
  });
});
