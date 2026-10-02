import { GraphQLError } from 'graphql';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../../../test/helpers/silentLogger.js';
import { AppError } from '../../../helpers/appError.js';
import { createErrorFormatter } from './errors.js';

describe('GraphQL error formatter', () => {
  const format = createErrorFormatter(silentLogger);

  it('carries REST codes and details, with 200 when there is data', () => {
    const error = new GraphQLError('masked', {
      path: ['a', 0, 'b'],
      originalError: new AppError(403, 'FORBIDDEN_FIELD', 'nope', { field: 'b' }),
    });
    const result = format({ data: { a: [{ b: null }] }, errors: [error] });
    expect(result.statusCode).toBe(200);
    expect(result.response.errors[0]).toMatchObject({
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
    const internal = createErrorFormatter(log)({
      data: { a: null },
      errors: [new GraphQLError('db exploded', { originalError: new Error('password=hunter2') })],
    });
    expect(internal.response.errors[0]).toMatchObject({
      message: 'Internal server error',
      extensions: { code: 'INTERNAL_ERROR' },
    });
    expect(JSON.stringify(internal)).not.toContain('hunter2');
    expect(log.error).toHaveBeenCalled();
  });

  it('expands mercurius validation wrappers into 400s', () => {
    const wrapper = Object.assign(new Error('Graphql validation error'), {
      statusCode: 400,
      errors: [new GraphQLError('Cannot query field "x"')],
    });
    const result = format({ errors: [new GraphQLError(wrapper.message, { originalError: wrapper })] });
    expect(result.statusCode).toBe(400);
    expect(result.response.errors).toEqual([
      expect.objectContaining({
        message: 'Cannot query field "x"',
        extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
      }),
    ]);
  });
});
