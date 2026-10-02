import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { CodeEditor } from '../CodeEditor';
import { LOCK_PATH } from '../helpers/files';

type LockFileProps = { text: string };

const noIssues = () => [];

/** The lock file pull writes: what each file was loaded from (the base of the three-way guard). */
export const LockFile = ({ text }: LockFileProps) => {
  const { t } = useTranslation();
  return (
    <Panel title={LOCK_PATH} description={t('develop.schema.lockDescription')} flush>
      <CodeEditor
        className="h-[28rem] rounded-none border-0 xl:h-[40rem]"
        value={text}
        onChange={noIssues}
        label={t('develop.schema.editorLabel', { path: LOCK_PATH })}
        readOnly
        schema={undefined}
        lint={noIssues}
      />
    </Panel>
  );
};
