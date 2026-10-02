import type { SchemaDefinition } from '@shapio/schema';
import { useCallback, useMemo, useState } from 'react';
import { useSchemaExport, type ExportedDefinition, type SchemaExport } from '@/api/schemaFiles';
import { buildFiles, buildLockText, type SchemaFile } from '../helpers/files';

/**
 * The files on screen and their edits. Until something is edited the files mirror the instance (like a
 * fresh pull); the first edit pins what they were loaded from, which is the base the three-way guard
 * compares against at apply time. `reload` drops every edit and pulls again.
 */
export type SchemaWorkspace = {
  schemaVersion: number;
  files: SchemaFile[];
  lockText: string;
  /** Every loaded definition (cross-definition checks run against these). */
  definitions: SchemaDefinition[];
  textOf: (file: SchemaFile) => string;
  setText: (file: SchemaFile, text: string) => void;
  dirtyFiles: SchemaFile[];
  isDirty: (file: SchemaFile) => boolean;
  /** Takes the instance's current version of one definition as the file's new base, dropping its edits. */
  takeRemote: (remote: ExportedDefinition) => void;
  /** Rebases the file's edits onto the instance's current version (they win over the remote changes). */
  keepLocal: (remote: ExportedDefinition) => void;
  reload: () => Promise<unknown>;
};

const replaceDefinition = (loaded: SchemaExport, remote: ExportedDefinition): SchemaExport => ({
  ...loaded,
  definitions: loaded.definitions.map((entry) =>
    entry.definition.id === remote.definition.id ? remote : entry,
  ),
});

export const useSchemaWorkspace = () => {
  const query = useSchemaExport();
  const [pinned, setPinned] = useState<SchemaExport | undefined>();
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const loaded = pinned ?? query.data;

  const files = useMemo(() => (loaded ? buildFiles(loaded) : []), [loaded]);
  const lockText = useMemo(() => (loaded ? buildLockText(loaded) : ''), [loaded]);
  const definitions = useMemo(() => files.map((file) => file.base.definition), [files]);

  const textOf = useCallback((file: SchemaFile) => texts[file.definitionId] ?? file.base.text, [texts]);
  const isDirty = useCallback(
    (file: SchemaFile) => {
      const text = texts[file.definitionId];
      return text !== undefined && text !== file.base.text;
    },
    [texts],
  );
  const setText = useCallback(
    (file: SchemaFile, text: string) => {
      setPinned((current) => current ?? loaded);
      setTexts((current) => ({ ...current, [file.definitionId]: text }));
    },
    [loaded],
  );
  const takeRemote = useCallback((remote: ExportedDefinition) => {
    setPinned((current) => (current ? replaceDefinition(current, remote) : current));
    setTexts(({ [remote.definition.id]: _dropped, ...rest }) => rest);
  }, []);
  const keepLocal = useCallback((remote: ExportedDefinition) => {
    setPinned((current) => (current ? replaceDefinition(current, remote) : current));
  }, []);
  const { refetch } = query;
  const reload = useCallback(async () => {
    setPinned(undefined);
    setTexts({});
    return refetch();
  }, [refetch]);

  const dirtyFiles = useMemo(() => files.filter(isDirty), [files, isDirty]);
  const workspace = useMemo<SchemaWorkspace | undefined>(
    () =>
      loaded
        ? {
            schemaVersion: loaded.schemaVersion,
            files,
            lockText,
            definitions,
            textOf,
            setText,
            dirtyFiles,
            isDirty,
            takeRemote,
            keepLocal,
            reload,
          }
        : undefined,
    [
      loaded,
      files,
      lockText,
      definitions,
      textOf,
      setText,
      dirtyFiles,
      isDirty,
      takeRemote,
      keepLocal,
      reload,
    ],
  );
  return { query, workspace };
};
