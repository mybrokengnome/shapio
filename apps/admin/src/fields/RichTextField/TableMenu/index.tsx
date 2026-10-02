import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Table } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type TableMenuProps = { editor: Editor; inTable: boolean; disabled: boolean };

const NEW_TABLE = { rows: 3, cols: 3, withHeaderRow: true };

/** Insert a table (with a header row), or change the one the cursor is in. Columns resize by dragging. */
export const TableMenu = ({ editor, inTable, disabled }: TableMenuProps) => {
  const { t } = useTranslation();
  const run = (action: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) =>
    action(editor.chain().focus()).run();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('content.richText.table')}
          aria-pressed={inTable}
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
        >
          <Table aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      {/* Back to the document after an action, not to the menu button, so typing continues in the table. */}
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        <DropdownMenuItem
          disabled={inTable}
          onSelect={() =>
            run((chain) =>
              chain
                // A selected image or rule would be replaced by the table: insert after it instead.
                .command(({ tr }) => {
                  if (tr.selection instanceof NodeSelection) {
                    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.to)));
                  }
                  return true;
                })
                .insertTable(NEW_TABLE),
            )
          }
        >
          {t('content.richText.insertTable')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!inTable} onSelect={() => run((chain) => chain.addRowAfter())}>
          {t('content.richText.addRow')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!inTable} onSelect={() => run((chain) => chain.addColumnAfter())}>
          {t('content.richText.addColumn')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!inTable} onSelect={() => run((chain) => chain.toggleHeaderRow())}>
          {t('content.richText.toggleHeaderRow')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!inTable} onSelect={() => run((chain) => chain.deleteRow())}>
          {t('content.richText.deleteRow')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!inTable} onSelect={() => run((chain) => chain.deleteColumn())}>
          {t('content.richText.deleteColumn')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!inTable}
          variant="destructive"
          onSelect={() => run((chain) => chain.deleteTable())}
        >
          {t('content.richText.deleteTable')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
