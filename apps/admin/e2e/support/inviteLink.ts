import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACTS_DIR } from './constants';

/** admin3Team.spec.ts invites a user; admin4Auth.spec.ts accepts the link it showed. Kept in the run's files. */
const INVITE_LINK_FILE = join(ARTIFACTS_DIR, 'invite-link.txt');

export const saveInviteLink = (link: string) => writeFileSync(INVITE_LINK_FILE, link);

export const readInviteLink = () => readFileSync(INVITE_LINK_FILE, 'utf8');
