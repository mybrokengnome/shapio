import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { PenLine, Sparkles, WandSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDeferredMenuAction } from '../../hooks/useDeferredMenuAction';
import { hasTextSelection } from '../textSelection';

type AssistMenuProps = {
  editor: Editor;
  disabled: boolean;
  /** Write… where the cursor is (after its block, or in place of it when empty). */
  onWrite: () => void;
  /** Continue writing at the end of the text. */
  onContinue: () => void;
  /** Rewrite… the selected text. */
  onRewrite: () => void;
};

/**
 * The form editor's Assist menu (only while assist is on): the same Write…, Continue writing and Rewrite… as
 * the document's `/` menu and floating toolbar. Rewrite… needs selected text. The chosen action runs once the
 * menu has closed, so its popover takes focus.
 */
export const AssistMenu = ({ editor, disabled, onWrite, onContinue, onRewrite }: AssistMenuProps) => {
  const { t } = useTranslation();
  const menu = useDeferredMenuAction();
  const canRewrite = useEditorState({ editor, selector: hasTextSelection });
  const label = t('assist.menu');
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={label}>
              <Sparkles aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <DropdownMenuItem onSelect={() => menu.defer(onWrite)}>
          <Sparkles aria-hidden="true" />
          {t('assist.write.section')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => menu.defer(onContinue)}>
          <PenLine aria-hidden="true" />
          {t('assist.write.continue')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canRewrite} onSelect={() => menu.defer(onRewrite)}>
          <WandSparkles aria-hidden="true" />
          {t('assist.rewrite.open')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
