import { findInvalidText, INVALID_TEXT_MESSAGE } from '@shapio/schema';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../helpers/appError.js';

/**
 * Refuses a NUL character or an unpaired surrogate anywhere in a request's parsed body, querystring or route
 * params (422 `INVALID_TEXT`, with a JSON pointer such as `/query/filters[title][$eq]`). No database stores
 * them as is, so without this they surface as internal errors, including on anonymous delivery routes.
 * File uploads are not parsed into objects and are not affected.
 */
export const textInputPlugin = fp(
  async (app: FastifyInstance) => {
    app.addHook('preValidation', async (request) => {
      for (const [part, value] of [
        ['params', request.params],
        ['query', request.query],
        ['body', request.body],
      ] as const) {
        const path = findInvalidText(value, `/${part}`);
        if (path !== undefined) {
          throw new AppError(422, 'INVALID_TEXT', `Text ${INVALID_TEXT_MESSAGE}`, { path });
        }
      }
    });
  },
  { name: 'shapio-text-input' },
);
