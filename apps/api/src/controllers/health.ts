import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../helpers/appError.js';
import * as healthService from '../services/health.js';

export const getHealth = async () => ({ status: 'ok' as const });

export const getReady = async (request: FastifyRequest, reply: FastifyReply) => {
  const readiness = await healthService.checkReadiness();
  if (!readiness.ready) {
    request.log.warn({ readiness }, 'not ready');
    throw new AppError(503, 'NOT_READY', 'Service is not ready', {
      checks: readiness.checks,
      pendingMigrations: readiness.pendingMigrations,
    });
  }
  return reply.send({ status: 'ready' as const, checks: readiness.checks });
};

export const getVersion = async () => healthService.getVersionInfo();
