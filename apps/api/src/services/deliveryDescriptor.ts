import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { StorageConfig } from '../config/index.js';
import { DELIVERY_DESCRIPTOR_SETTING } from '../constants/delivery.js';
import type { Database } from '../db/index.js';
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import * as systemSettingsRepository from '../repositories/systemSettings.js';

/**
 * What an in-process delivery reader (plan next-in-process §2) needs from the server's configuration to answer
 * exactly as the server does, without its environment: where Shapio is served (absolute media URLs) and where
 * media lives. Never a secret: S3 credentials and the signing secret are the reader's own options.
 */
const DeliveryDescriptorSchema = Type.Object({
  format: Type.Literal(1),
  publicUrl: Type.String(),
  basePath: Type.String(),
  media: Type.Object({
    publicBaseUrl: Type.Union([Type.String(), Type.Null()]),
    s3: Type.Union([
      Type.Object({
        bucket: Type.String(),
        region: Type.Union([Type.String(), Type.Null()]),
        endpoint: Type.Union([Type.String(), Type.Null()]),
        forcePathStyle: Type.Boolean(),
      }),
      Type.Null(),
    ]),
  }),
});

export type DeliveryDescriptor = Static<typeof DeliveryDescriptorSchema>;

type DescriptorSource = {
  server: { publicUrl: string; basePath: string };
  storage: Pick<StorageConfig, 'publicBaseUrl' | 's3'>;
};

export const toDeliveryDescriptor = ({ server, storage }: DescriptorSource): DeliveryDescriptor => ({
  format: 1,
  publicUrl: server.publicUrl,
  basePath: server.basePath,
  media: {
    publicBaseUrl: storage.publicBaseUrl ?? null,
    s3: storage.s3
      ? {
          bucket: storage.s3.bucket,
          region: storage.s3.region ?? null,
          endpoint: storage.s3.endpoint ?? null,
          forcePathStyle: storage.s3.forcePathStyle,
        }
      : null,
  },
});

export class InvalidDeliveryDescriptorError extends Error {
  constructor(options?: ErrorOptions) {
    super('The delivery descriptor stored by the Shapio server is not readable by this release', options);
    this.name = 'InvalidDeliveryDescriptorError';
  }
}

/** Parses the stored descriptor; throws when it is not in a format this release reads. */
export const parseDeliveryDescriptor = (stored: string): DeliveryDescriptor => {
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch (error) {
    throw new InvalidDeliveryDescriptorError({ cause: error });
  }
  if (!Value.Check(DeliveryDescriptorSchema, value)) {
    throw new InvalidDeliveryDescriptorError();
  }
  return value;
};

/**
 * Called by the server at every start, after migrating: records its release and its delivery descriptor
 * (rewritten only when it changed), in one transaction.
 */
export const publishServerRelease = async (
  database: Database,
  release: string,
  source: DescriptorSource,
): Promise<void> => {
  const descriptor = JSON.stringify(toDeliveryDescriptor(source));
  await database.transaction().execute(async (trx) => {
    await schemaVersionsRepository.setRelease(release, trx);
    if ((await systemSettingsRepository.findValue(DELIVERY_DESCRIPTOR_SETTING, trx)) !== descriptor) {
      await systemSettingsRepository.upsertValue(DELIVERY_DESCRIPTOR_SETTING, descriptor, trx);
    }
  });
};
