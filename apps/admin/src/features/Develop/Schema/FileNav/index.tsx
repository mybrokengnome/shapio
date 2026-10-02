import { Braces, Lock, Puzzle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SubNav, SubNavGroup } from '@/components/SubNav';
import { SubNavLink } from '@/components/SubNavLink';
import { LOCK_PATH, type SchemaFile } from '../helpers/files';

type FileLinkProps = { path: string; dirty: boolean; open: boolean; icon: typeof Braces };

const FileLink = ({ path, dirty, open, icon: Icon }: FileLinkProps) => {
  const { t } = useTranslation();
  const name = path.slice(path.lastIndexOf('/') + 1);
  return (
    <SubNavLink to="/schema" search={{ file: path }} title={path} aria-current={open ? 'page' : undefined}>
      <Icon aria-hidden="true" />
      <span className="min-w-0 truncate font-mono text-xs">{name}</span>
      {dirty ? (
        <>
          <span aria-hidden="true" className="ml-auto size-2 shrink-0 rounded-full bg-warning" />
          <span className="sr-only">{t('develop.schema.modified')}</span>
        </>
      ) : null}
    </SubNavLink>
  );
};

type FileNavProps = {
  files: readonly SchemaFile[];
  /** The open file's path. */
  openPath: string;
  isDirty: (file: SchemaFile) => boolean;
};

/** The schema directory as `shapio schema pull` writes it: models, components and the lock file. */
export const FileNav = ({ files, openPath, isDirty }: FileNavProps) => {
  const { t } = useTranslation();
  const models = files.filter((file) => file.category === 'model');
  const components = files.filter((file) => file.category === 'component');
  return (
    <SubNav label={t('develop.schema.files')}>
      {models.length > 0 ? (
        <SubNavGroup label={t('develop.schema.modelsDir')}>
          {models.map((file) => (
            <FileLink
              key={file.definitionId}
              path={file.path}
              dirty={isDirty(file)}
              open={file.path === openPath}
              icon={Braces}
            />
          ))}
        </SubNavGroup>
      ) : null}
      {components.length > 0 ? (
        <SubNavGroup label={t('develop.schema.componentsDir')}>
          {components.map((file) => (
            <FileLink
              key={file.definitionId}
              path={file.path}
              dirty={isDirty(file)}
              open={file.path === openPath}
              icon={Puzzle}
            />
          ))}
        </SubNavGroup>
      ) : null}
      <SubNavGroup label={t('develop.schema.lockDir')}>
        <FileLink path={LOCK_PATH} dirty={false} open={openPath === LOCK_PATH} icon={Lock} />
      </SubNavGroup>
    </SubNav>
  );
};
