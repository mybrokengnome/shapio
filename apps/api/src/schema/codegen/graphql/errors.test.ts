import { GraphQLError } from 'graphql';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../../../test/helpers/silentLogger.js';
import { AppError } from '../../../helpers/appError.js';
import { formatGraphqlRequestError, formatGraphqlResult } from './errors.js';

describe('GraphQL error formatter', () => {
  const format = (result: Parameters<typeof formatGraphqlResult>[0]) =>
    formatGraphqlResult(result, { log: silentLogger });

  it('carries REST codes and details, with 200 when there is data', () => {
    const error = new GraphQLError('masked', {
      path: ['a', 0, 'b'],
      originalError: new AppError(403, 'FORBIDDEN_FIELD', 'nope', { field: 'b' }),
    });
    const result = format({ data: { a: [{ b: null }] }, errors: [error] });
    expect(result.statusCode).toBe(200);
    expect(result.body.errors?.[0]).toMatchObject({
      message: 'nope',
      path: ['a', 0, 'b'],
      extensions: { code: 'FORBIDDEN_FIELD', details: { field: 'b' } },
    });
  });

  it('uses the status of a request-level failure and never leaks internal errors', () => {
    const rejected = format({
      errors: [new GraphQLError('x', { originalError: new AppError(401, 'UNAUTHENTICATED', 'Sign in') })],
    });
    expect(rejected.statusCode).toBe(401);
    const log = { ...silentLogger, error: vi.fn() } as unknown as typeof silentLogger;
    const internal = formatGraphqlResult(
      {
        data: { a: null },
        errors: [new GraphQLError('db exploded', { originalError: new Error('password=hunter2') })],
      },
      { log },
    );
    expect(internal.body.errors?.[0]).toMatchObject({
      message: 'Internal server error',
      extensions: { code: 'INTERNAL_ERROR' },
    });
    expect(JSON.stringify(internal)).not.toContain('hunter2');
    expect(log.error).toHaveBeenCalled();
  });

  it('reports parse and validation failures as 400 without data, hiding suggestions on request', () => {
    const invalid = new GraphQLError('Cannot query field "titel" on type "Post". Did you mean "title"?');
    const shown = format({ errors: [invalid] });
    expect(shown.statusCode).toBe(400);
    expect(shown.body).toEqual({
      data: null,
      errors: [expect.objectContaining({ extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } })],
    });
    const hidden = formatGraphqlResult({ errors: [invalid] }, { log: silentLogger, hideSuggestions: true });
    expect(hidden.body.errors?.[0]?.message).toBe('Cannot query field "titel" on type "Post".');
  });

  it('answers without errors when there are none', () => {
    expect(format({ data: { a: 1 } })).toEqual({ statusCode: 200, body: { data: { a: 1 } } });
  });

  it('wraps request errors (credentials, CSRF, request validation) in the GraphQL envelope', () => {
    const csrf = formatGraphqlRequestError(
      Object.assign(new Error('bad token'), { code: 'FST_CSRF_INVALID_TOKEN', statusCode: 403 }),
      silentLogger,
    );
    expect(csrf).toEqual({
      statusCode: 403,
      body: {
        data: null,
        errors: [{ message: 'Missing or invalid CSRF token', extensions: { code: 'CSRF_INVALID' } }],
      },
    });
    const notAllowed = formatGraphqlRequestError(
      new AppError(405, 'METHOD_NOT_ALLOWED', 'Use POST'),
      silentLogger,
    );
    expect(notAllowed.statusCode).toBe(405);
    expect(notAllowed.body.errors?.[0]?.extensions?.code).toBe('METHOD_NOT_ALLOWED');
    const invalidBody = formatGraphqlRequestError(
      Object.assign(new Error('body must have required property query'), {
        statusCode: 400,
        validation: [],
      }),
      silentLogger,
    );
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.body.errors?.[0]?.extensions?.code).toBe('VALIDATION_ERROR');
  });
});
