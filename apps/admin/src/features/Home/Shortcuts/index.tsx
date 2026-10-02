import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import type { ShortcutItem } from '../hooks/useShortcuts';
import { Shortcut } from '../Shortcut';

type ShortcutsProps = { shortcuts: readonly ShortcutItem[] };

export const Shortcuts = ({ shortcuts }: ShortcutsProps) => {
  const { t } = useTranslation();
  if (shortcuts.length === 0) {
    return null;
  }
  return (
    <Panel title={t('home.shortcuts')}>
      <ul className="-mx-2 space-y-0.5">
        {shortcuts.map(({ key, label, icon, link }) => (
          <li key={key}>
            <Shortcut label={label} icon={icon} link={link} />
          </li>
        ))}
      </ul>
    </Panel>
  );
};
