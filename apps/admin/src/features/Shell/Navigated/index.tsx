import { Outlet } from '@tanstack/react-router';
import { CommandPalette } from '@/components/CommandPalette';
import { Frame } from '../Frame';
import { useActiveNavKey } from '../hooks/useActiveNavKey';
import { useShellNavGroups } from '../hooks/useShellNavGroups';
import { useShellPaletteItems } from '../hooks/useShellPaletteItems';

/** The frame with the navigation, the current screen and the ⌘K palette: the admin works on this site. */
export const Navigated = () => {
  const groups = useShellNavGroups();
  const activeKey = useActiveNavKey(groups);
  const section = groups.flatMap((group) => group.items).find((item) => item.key === activeKey)?.label;
  useShellPaletteItems(groups);
  return (
    <>
      <Frame groups={groups} activeKey={activeKey} section={section} searchable>
        <Outlet />
      </Frame>
      <CommandPalette />
    </>
  );
};
