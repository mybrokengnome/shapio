import { describe, expect, it } from 'vitest';
import {
  InvalidDeliveryDescriptorError,
  parseDeliveryDescriptor,
  toDeliveryDescriptor,
} from './deliveryDescriptor.js';

describe('delivery descriptor', () => {
  it('keeps what delivery URLs need and no secret', () => {
    const descriptor = toDeliveryDescriptor({
      server: { publicUrl: 'https://cms.example.com', basePath: '/cms' },
      storage: {
        publicBaseUrl: 'https://cdn.example.com',
        s3: {
          bucket: 'media',
          region: 'eu-west-1',
          endpoint: undefined,
          accessKeyId: 'AKIA-SECRET',
          secretAccessKey: 'very-secret',
          forcePathStyle: false,
        },
      },
    });
    expect(descriptor).toEqual({
      format: 1,
      publicUrl: 'https://cms.example.com',
      basePath: '/cms',
      media: {
        publicBaseUrl: 'https://cdn.example.com',
        s3: { bucket: 'media', region: 'eu-west-1', endpoint: null, forcePathStyle: false },
      },
    });
    expect(JSON.stringify(descriptor)).not.toMatch(/SECRET|secret/);
    expect(parseDeliveryDescriptor(JSON.stringify(descriptor))).toEqual(descriptor);
  });

  it('refuses a descriptor in another format', () => {
    expect(() => parseDeliveryDescriptor('{"format":2}')).toThrow(InvalidDeliveryDescriptorError);
    expect(() => parseDeliveryDescriptor('not json')).toThrow(InvalidDeliveryDescriptorError);
  });
});
