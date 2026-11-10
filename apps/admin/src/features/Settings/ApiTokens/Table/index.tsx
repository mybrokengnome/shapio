import type { ApiToken } from '@shapio/client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { TableCard } from '@/components/TableCard';
import { Button } from '@/components/ui/button';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { schemaVersionNoteOf } from '../helpers/schemaVersionPin';
import { TokenStatus } from './TokenStatus';

type TableProps = {
  /** The tokens to list (revoked ones already left out: see `listedTokens`). */
  tokens: ApiToken[];
  roleNames: ReadonlyMap<string, string>;
  /** Roles that grant Read drafts: their tokens get a Drafts chip (development tokens). */
  draftRoleIds: ReadonlySet<string>;
  /** This site's name: every token not marked "Every site" belongs to it. */
  siteName: string;
  /** The schema version a token's latest request named, by token ID (tokens that name none are absent). */
  schemaVersions: ReadonlyMap<string, number>;
  /** Opens the token's edit sheet (its schema version pin). */
  onEdit: (token: ApiToken) => void;
  /** Resolves once the token is revoked (the confirmation waits for it). */
  onRevoke: (token: ApiToken) => Promise<unknown>;
};

const SCHEMA_VERSION_NOTE_KEYS = {
  pinned: 'apiTokens.pinnedToSchemaVersion',
  sends: 'apiTokens.sendsSchemaVersion',
} as const;

export const Table = ({
  tokens,
  roleNames,
  draftRoleIds,
  siteName,
  schemaVersions,
  onEdit,
  onRevoke,
}: TableProps) => {
  const { t } = useTranslation();
  // One clock for every row's status, read when the list opens.
  const [now] = useState(() => Date.now());
  return (
    <TableCard>
      <TableRoot>
        <TableHeader>
          <TableRow>
            <TableHead>{t('apiTokens.name')}</TableHead>
            <TableHead>{t('apiTokens.role')}</TableHead>
            <TableHead>{t('apiTokens.status')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => {
            const versionNote = schemaVersionNoteOf(token.pinnedSchemaVersion, schemaVersions.get(token.id));
            return (
              <TableRow key={token.id}>
                {/* Long names wrap here, so the status and Revoke stay in view on a narrow laptop. */}
                <TableCell className="whitespace-normal">
                  <RowTitle>{token.name}</RowTitle>
                  {/* The token's start and when it was last used, under its name: four columns fit a laptop. */}
                  <span className="block text-meta text-muted-foreground">
                    <span className="font-mono">{`${token.tokenPrefix}…`}</span>
                    {' · '}
                    <span title={formatDateTime(token.lastUsedAt) || undefined}>
                      {token.lastUsedAt
                        ? t('apiTokens.lastUsedAt', { time: formatRelativeTime(token.lastUsedAt) })
                        : t('apiTokens.neverUsed')}
                    </span>
                    {versionNote ? (
                      <>
                        {' · '}
                        <span data-schema-version={versionNote.kind}>
                          {t(SCHEMA_VERSION_NOTE_KEYS[versionNote.kind], { version: versionNote.version })}
                        </span>
                      </>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {roleNames.get(token.roleId) ?? t('common.unknown')}
                    {draftRoleIds.has(token.roleId) ? (
                      <StatusChip tone="warning" size="sm" label={t('apiTokens.draftsChip')} />
                    ) : null}
                  </span>
                  {/* Where the role applies, under it. */}
                  <span className="block text-meta text-muted-foreground">
                    {token.siteId === null ? t('sites.everySite') : siteName}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-col items-start gap-1">
                    <TokenStatus token={token} now={now} />
                    {token.pinnedSchemaVersionAvailable ? null : (
                      <StatusChip tone="warning" size="sm" label={t('apiTokens.pinUnavailable')} />
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`${t('common.edit')}: ${token.name}`}
                      onClick={() => onEdit(token)}
                    >
                      {t('common.edit')}
                    </Button>
                    <InlineConfirm
                      tone="danger"
                      title={t('apiTokens.revokeTitle', { name: token.name })}
                      description={t('apiTokens.revokeDescription')}
                      confirmLabel={t('common.revoke')}
                      onConfirm={() => onRevoke(token)}
                      trigger={
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`${t('common.revoke')}: ${token.name}`}
                        >
                          {t('common.revoke')}
                        </Button>
                      }
                    />
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </TableRoot>
    </TableCard>
  );
};
