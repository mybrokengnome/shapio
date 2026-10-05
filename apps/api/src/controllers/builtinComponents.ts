import type { FastifyReply, FastifyRequest } from 'fastify';
import * as builtinComponentsService from '../services/builtinComponents.js';
import { schemaContextFor } from './schemaContext.js';

export const ensureSeoComponent = async (request: FastifyRequest, reply: FastifyReply) => {
  const outcome = await builtinComponentsService.ensureSeoComponent(await schemaContextFor(request));
  return reply.code(outcome.status === 'created' ? 201 : 200).send(outcome);
};
