import type { FastifyRequest } from 'fastify';
import * as contentTargetsService from '../services/contentTargets.js';
import { contentContextFor } from './contentContext.js';

type ContentTargetsRequest = FastifyRequest<{
  Querystring: {
    field: string;
    types?: string;
    q?: string;
    page?: number;
    pageSize?: number;
    locale?: string;
    ids?: string;
  };
}>;

const listOf = (value: string | undefined): string[] | undefined =>
  value === undefined
    ? undefined
    : value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

export const listContentTargets = async (request: ContentTargetsRequest) => {
  const { field, types, q, page, pageSize, locale, ids } = request.query;
  const typeList = listOf(types);
  const idList = listOf(ids);
  return contentTargetsService.listContentTargets(await contentContextFor(request), {
    field,
    ...(typeList ? { types: typeList } : {}),
    ...(q !== undefined ? { q } : {}),
    ...(page !== undefined ? { page } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
    ...(locale !== undefined ? { locale } : {}),
    ...(idList ? { ids: idList } : {}),
  });
};
