import type { Editor } from '@tiptap/core';
import { Link as LinkIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { normalizeHref } from '../richTextDocument';
import { selectionAnchor } from '../selectionAnchor';

type LinkPopoverProps = {
  editor: Editor;
  active: boolean;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Anchor the popover to the selection instead of rendering its own toolbar button (the canvas's floating
   * toolbar disappears when focus leaves the text, so the popover can't live inside it).
   */
  anchorToSelection?: boolean;
};

/** Add, change or remove the link on the selection (Mod+Shift+K). Only safe protocols are accepted. */
export const LinkPopover = ({
  editor,
  active,
  disabled,
  open,
  onOpenChange,
  anchorToSelection = false,
}: LinkPopoverProps) => {
  const { t } = useTranslation();
  const id = useId();
  const [href, setHref] = useState('');
  const [invalid, setInvalid] = useState(false);
  const label = t('content.richText.link');
  const changeOpen = (next: boolean) => {
    if (next) {
      const current: unknown = editor.getAttributes('link').href;
      setHref(typeof current === 'string' ? current : '');
      setInvalid(false);
    }
    onOpenChange(next);
  };
  const apply = () => {
    const safe = normalizeHref(href);
    if (href.trim() !== '' && !safe) {
      setInvalid(true);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    (safe ? chain.setLink({ href: safe }) : chain.unsetLink()).run();
    onOpenChange(false);
  };
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      {anchorToSelection ? (
        <PopoverAnchor virtualRef={selectionAnchor(editor)} />
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                aria-pressed={active}
                disabled={disabled}
                className="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
              >
                <LinkIcon aria-hidden="true" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {t('content.richText.shortcut', { action: label, keys: 'Mod+Shift+K' })}
          </TooltipContent>
        </Tooltip>
      )}
      <PopoverContent
        align="start"
        className="w-80 font-sans"
        // Back to the text, so typing continues where the link was made.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            apply();
          }}
        >
          <Label htmlFor={id}>{t('content.richText.linkUrl')}</Label>
          <Input
            id={id}
            value={href}
            autoFocus
            inputMode="url"
            placeholder={t('content.richText.linkPlaceholder')}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => {
              setHref(event.target.value);
              setInvalid(false);
            }}
          />
          {invalid ? (
            <p id={`${id}-error`} className="text-meta text-destructive">
              {t('content.richText.linkInvalid')}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {active ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run();
                  onOpenChange(false);
                }}
              >
                {t('content.richText.removeLink')}
              </Button>
            ) : null}
            <Button type="submit" size="sm">
              {t('content.richText.applyLink')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
};
