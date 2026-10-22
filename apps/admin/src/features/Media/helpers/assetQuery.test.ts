import { describe, expect, it } from 'vitest';
import { kindFilterFor } from '@/fields/helpers/media';
import { MEDIA_TYPE_FILTERS } from '../constants';
import { assetTypeQuery } from './assetQuery';

/** Characters a web application firewall's SQL injection rules react to in a query string. */
const SQL_LOOKALIKE = /\/\*|--|'|;/;

describe('assetTypeQuery', () => {
  it('sends a MIME family as kind and an exact type as mimeType', () => {
    expect(assetTypeQuery('image')).toEqual({ kind: 'image' });
    expect(assetTypeQuery('video')).toEqual({ kind: 'video' });
    expect(assetTypeQuery('audio')).toEqual({ kind: 'audio' });
    expect(assetTypeQuery('pdf')).toEqual({ mimeType: 'application/pdf' });
    expect(assetTypeQuery(undefined)).toEqual({});
  });

  it('lets the allowed kind of a picker win over the chosen type', () => {
    expect(assetTypeQuery('pdf', kindFilterFor(['image']))).toEqual({ kind: 'image' });
    expect(assetTypeQuery('pdf', kindFilterFor(['image', 'video']))).toEqual({ mimeType: 'application/pdf' });
  });

  it('never builds a value a firewall could take for SQL', () => {
    const forced = (['image', 'video', 'audio', 'document', 'other'] as const).map((kind) =>
      kindFilterFor([kind]),
    );
    const queries = [
      ...MEDIA_TYPE_FILTERS.map((type) => assetTypeQuery(type)),
      ...forced.map((f) => assetTypeQuery(undefined, f)),
    ];
    for (const value of queries.flatMap((query) => Object.values(query))) {
      expect(value).not.toMatch(SQL_LOOKALIKE);
    }
  });
});
