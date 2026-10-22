import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { ImageOff, Trash2 } from 'lucide-react';
import { useContext, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaAsset } from '@/api/media';
import { SuggestAltButton } from '@/components/SuggestAltButton';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/helpers/cn';
import { FieldsEnvironmentContext } from '../../form/context';
import type { EditorAppearance } from '../../types';
import { useNodeTextInput } from '../hooks/useNodeTextInput';

const PREVIEW_VARIANTS = ['w1280', 'w640'];

type ImageViewProps = ReactNodeViewProps & { appearance?: EditorAppearance };

const textAttribute = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * An image in rich text: the library asset's preview, its alt text for this use, and remove. In the canvas
 * it also shows a caption: the asset's library caption, which the node's `title` overrides for this use.
 */
export const ImageView = ({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
  appearance = 'form',
}: ImageViewProps) => {
  const { t } = useTranslation();
  const mediaId = typeof node.attrs.mediaId === 'string' ? node.attrs.mediaId : undefined;
  const alt = textAttribute(node.attrs.alt);
  const caption = textAttribute(node.attrs.title);
  const asset = useMediaAsset(mediaId);
  const preview =
    PREVIEW_VARIANTS.map(
      (name) => asset.data?.variants.find((variant) => variant.name === name && variant.url)?.url,
    ).find(Boolean) ?? asset.data?.url;
  const editable = editor.isEditable;
  const altId = useId();
  const captionId = useId();
  const canvas = appearance === 'canvas';
  const locale = useContext(FieldsEnvironmentContext)?.locale;
  const setText = (name: 'alt' | 'title', text: string) =>
    updateAttributes({ [name]: text === '' ? null : text });
  const altInput = useNodeTextInput(alt, (text) => setText('alt', text));
  const captionInput = useNodeTextInput(caption, (text) => setText('title', text));
  return (
    <NodeViewWrapper
      as="figure"
      data-drag-handle
      data-media-id={mediaId}
      className={cn(
        'not-prose my-4 space-y-2',
        canvas ? 'font-sans' : 'rounded-lg border bg-card p-2',
        selected && 'rounded-lg ring-2 ring-ring ring-offset-2 ring-offset-background',
      )}
    >
      {asset.isPending ? (
        <Skeleton className={cn('w-full rounded-md', canvas ? 'h-72 rounded-xl' : 'h-48')} />
      ) : preview ? (
        <img
          src={preview}
          alt={alt}
          className={cn('w-full object-contain', canvas ? 'max-h-[32rem] rounded-xl' : 'max-h-96 rounded-md')}
        />
      ) : (
        <div className="flex h-32 items-center justify-center gap-2 rounded-md bg-muted text-sm text-muted-foreground">
          <ImageOff aria-hidden="true" className="size-4" />
          {t('content.richText.imageMissing')}
        </div>
      )}
      {canvas ? (
        <figcaption className="space-y-1">
          <label htmlFor={captionId} className="sr-only">
            {t('entry.image.caption')}
          </label>
          <textarea
            id={captionId}
            {...captionInput}
            rows={1}
            readOnly={!editable}
            placeholder={asset.data?.caption || t('entry.image.captionPlaceholder')}
            className="block field-sizing-content max-h-24 w-full resize-none rounded-md bg-transparent px-1 text-meta text-muted-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </figcaption>
      ) : null}
      {/* Top-aligned: the box grows to about four lines and the label and buttons stay by its first. */}
      <div className="flex items-start gap-2">
        <label
          htmlFor={altId}
          className="flex h-9 shrink-0 items-center text-meta font-semibold text-muted-foreground"
        >
          {t('content.richText.altLabel')}
        </label>
        <Textarea
          id={altId}
          {...altInput}
          rows={1}
          readOnly={!editable}
          placeholder={asset.data?.alt || t('content.richText.altPlaceholder')}
          className="max-h-24 min-h-9 min-w-0 flex-1 resize-none py-1.75"
          data-alt-input
        />
        {editable ? (
          <SuggestAltButton
            assetId={mediaId}
            mimeType={asset.data?.mimeType}
            locale={locale}
            onSuggest={(text) => setText('alt', text)}
            className="mt-0.5 shrink-0"
          />
        ) : null}
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="mt-0.5"
            aria-label={t('content.richText.removeImage')}
            onClick={deleteNode}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </NodeViewWrapper>
  );
};
