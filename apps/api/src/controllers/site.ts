import type { FastifyReply, FastifyRequest } from 'fastify';
import * as siteSeoService from '../services/siteSeo.js';
import { contentContextFor } from './contentContext.js';
import { sendCacheable } from './delivery.js';

export const getDeliverySite = async (request: FastifyRequest, reply: FastifyReply) =>
  sendCacheable(request, reply, await siteSeoService.getDeliverySite(await contentContextFor(request)));
