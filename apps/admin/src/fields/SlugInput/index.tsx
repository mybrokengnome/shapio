import { Link2, Link2Off } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSiblingValues } from '../form/context';
import { inputAria, stringOption, textValue } from '../helpers/props';
import { slugify } from '../helpers/slugify';
import type { BuiltInEditorProps } from '../types';

/** The text of the field a slug is generated from (`settings.sourceFieldId`, usually the title). */
const useSourceText = (props: BuiltInEditorProps): string | undefined => {
  const siblings = useSiblingValues();
  const sourceId = props.definition.type === 'slug' ? props.definition.settings.sourceFieldId : undefined;
  const source = siblings?.definition.fields.find((field) => field.id === sourceId);
  if (!source) {
    return undefined;
  }
  const value = siblings?.values[source.apiKey];
  return typeof value === 'string' ? value : '';
};

/**
 * `slugInput`: a URL slug that follows its source field (e.g. the title) until someone edits it by hand.
 * The lock button switches between following the source and keeping the slug as typed.
 */
export const SlugInput = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { value, onChange, onBlur, readOnly, disabled } = props;
  const sourceText = useSourceText(props);
  const text = textValue(value);
  const [following, setFollowing] = useState(
    () => sourceText !== undefined && (text === '' || text === slugify(sourceText)),
  );
  const lastSource = useRef(sourceText);
  useEffect(() => {
    if (sourceText === undefined || sourceText === lastSource.current) {
      return;
    }
    lastSource.current = sourceText;
    if (following && !readOnly) {
      const next = slugify(sourceText);
      onChange(next === '' ? null : next);
    }
  }, [sourceText, following, readOnly, onChange]);
  return (
    <div className="flex items-center gap-1">
      <Input
        {...inputAria(props)}
        value={text}
        placeholder={stringOption(props, 'placeholder')}
        readOnly={readOnly}
        disabled={disabled}
        spellCheck={false}
        className="font-mono text-sm"
        onChange={(event) => {
          setFollowing(false);
          onChange(event.target.value === '' ? null : event.target.value);
        }}
        onBlur={() => {
          // Tidy what was typed into the slug format when leaving the field.
          if (text && slugify(text) !== text) {
            onChange(slugify(text) || null);
          }
          onBlur();
        }}
      />
      {sourceText !== undefined && !readOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-pressed={following}
          aria-label={following ? t('content.fields.slug.unlink') : t('content.fields.slug.link')}
          title={following ? t('content.fields.slug.unlink') : t('content.fields.slug.link')}
          disabled={disabled}
          onClick={() => {
            if (!following) {
              const next = slugify(sourceText);
              onChange(next === '' ? null : next);
            }
            setFollowing(!following);
          }}
        >
          {following ? <Link2 aria-hidden="true" /> : <Link2Off aria-hidden="true" />}
        </Button>
      ) : null}
    </div>
  );
};
