import type { BlockList } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { PublishingConfig } from '../config/publishing.js';
import { toAllowlist } from '../config/publishing.js';
import { PROVIDER_POLL_INTERVAL_MS } from '../constants/publishing.js';
import type { Database } from '../db/index.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import type { OutboundPolicy, HostResolver } from './outbound/ssrf.js';
import { systemResolver } from './outbound/ssrf.js';
import { createSecretBox, type SecretBox } from './secretBox.js';
import type { SecretEnvironment } from './secretRefs.js';

/**
 * What the publishing services and job handlers share: the database, secret encryption, the URL builder,
 * the outbound-request policy inputs and a clock. Built once for the API (app.publishing) and once for the
 * worker, from the same config.
 */
export type PublishingRuntime = {
  db: Database;
  secrets: SecretBox;
  urls: UrlBuilder;
  config: PublishingConfig;
  allowlist: BlockList;
  resolve: HostResolver;
  log: FastifyBaseLogger;
  now: () => Date;
  /** How often provider status is polled (Cloudflare Pages). */
  pollIntervalMs: number;
  /** Where `${ENV:NAME}` secret references are read from (the process environment). */
  env: SecretEnvironment;
};

export type PublishingRuntimeOptions = {
  db: Database;
  signingSecret: string;
  urls: UrlBuilder;
  config: PublishingConfig;
  log: FastifyBaseLogger;
  /** DNS resolution for outbound requests (tests inject a controllable one). */
  resolve?: HostResolver;
  now?: () => Date;
  pollIntervalMs?: number;
  env?: SecretEnvironment;
};

export const createPublishingRuntime = (options: PublishingRuntimeOptions): PublishingRuntime => ({
  db: options.db,
  secrets: createSecretBox(options.signingSecret),
  urls: options.urls,
  config: options.config,
  allowlist: toAllowlist(options.config.privateNetworkAllowlist),
  resolve: options.resolve ?? systemResolver,
  log: options.log,
  now: options.now ?? (() => new Date()),
  pollIntervalMs: options.pollIntervalMs ?? PROVIDER_POLL_INTERVAL_MS,
  // The one place secret references read the environment; everything else gets typed config.
  env: options.env ?? process.env,
});

export const outboundPolicy = (runtime: PublishingRuntime, allowPrivateNetwork: boolean): OutboundPolicy => ({
  allowPrivateNetwork,
  allowlist: runtime.allowlist,
  resolve: runtime.resolve,
});
