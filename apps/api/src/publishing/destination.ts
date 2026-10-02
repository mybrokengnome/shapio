import { AppError } from '../helpers/appError.js';
import { OutboundBlockedError, parseDestination, resolveDestination } from './outbound/ssrf.js';
import { outboundPolicy, type PublishingRuntime } from './runtime.js';

/**
 * Early feedback when an admin saves a destination URL: malformed URLs and destinations the network policy
 * refuses are rejected now. Resolution failures are not (DNS may be down while saving); every request is
 * checked again when it is sent, which is what actually protects the network.
 */
export const assertDestinationAllowed = async (
  runtime: PublishingRuntime,
  url: string,
  allowPrivateNetwork: boolean,
  field = 'url',
): Promise<void> => {
  try {
    const parsed = parseDestination(url);
    await resolveDestination(parsed, outboundPolicy(runtime, allowPrivateNetwork));
  } catch (error) {
    if (error instanceof OutboundBlockedError && !error.message.startsWith('Could not resolve')) {
      throw new AppError(400, 'DESTINATION_NOT_ALLOWED', error.message, { field });
    }
  }
};
