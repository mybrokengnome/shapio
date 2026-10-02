import { ImagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { reportError } from '@/helpers/reportError';
import { useMediaPermissions } from '@/hooks/useMediaPermissions';
import { moveItem, toList } from '../helpers/values';
import type { BuiltInEditorProps } from '../types';
import { AssetTile } from './AssetTile';
import { Gallery } from './Gallery';

/**
 * `mediaPicker`: one or several files from the media library (chosen in a sheet, uploads included).
 * The value is asset IDs; previews, alt text and variants come from the library.
 */
export const MediaField = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { canWrite } = useMediaPermissions();
  const { value, onChange, onBlur, readOnly, disabled, definition, context, inputId, labelId, describedBy } =
    props;
  const settings = definition.type === 'media' ? definition.settings : { multiple: false };
  const multiple = settings.multiple;
  const ids = toList<string>(value).filter((id): id is string => typeof id === 'string');
  const editable = !readOnly && !disabled;
  const commit = (next: string[]) => {
    onChange(multiple ? (next.length > 0 ? next : null) : (next[0] ?? null));
    onBlur();
  };
  const pick = async () => {
    try {
      const picked = await context.pickMedia({
        multiple,
        ...('allowedKinds' in settings && settings.allowedKinds
          ? { allowedKinds: settings.allowedKinds }
          : {}),
      });
      if (picked && picked.length > 0) {
        const chosen = picked.map((asset) => asset.id);
        commit(multiple ? [...ids, ...chosen.filter((id) => !ids.includes(id))] : chosen.slice(0, 1));
      }
    } catch (error) {
      reportError(error, 'picking media');
    }
  };
  const max = 'max' in settings ? settings.max : undefined;
  if (multiple && props.appearance === 'canvas') {
    return (
      <Gallery
        ids={ids}
        labelId={labelId}
        inputId={inputId}
        editable={editable}
        canAdd={max === undefined || ids.length < max}
        onPick={() => void pick()}
        commit={commit}
      />
    );
  }
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={describedBy} className="space-y-2">
      {ids.length > 0 ? (
        <ul className="space-y-2">
          {ids.map((id, index) => (
            <AssetTile
              key={id}
              assetId={id}
              inputId={inputId}
              index={index}
              count={ids.length}
              editable={editable}
              canEditAlt={canWrite && !readOnly}
              onMove={multiple ? (to) => commit(moveItem(ids, index, to)) : undefined}
              onRemove={() => commit(ids.filter((item) => item !== id))}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('content.media.empty')}</p>
      )}
      {editable && (multiple ? max === undefined || ids.length < max : true) ? (
        <Button id={inputId} type="button" variant="outline" size="sm" onClick={() => void pick()}>
          <ImagePlus aria-hidden="true" />
          {multiple
            ? t('content.media.add')
            : ids.length > 0
              ? t('content.media.replace')
              : t('content.media.chooseOne')}
        </Button>
      ) : null}
    </div>
  );
};
