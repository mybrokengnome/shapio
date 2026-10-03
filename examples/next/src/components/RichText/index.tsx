import type { ShapioAttributes } from '@shapio/visual';
import type { RichText as RichTextValue } from '../../lib/types';

type RichTextProps = {
  value: RichTextValue | null;
  className?: string;
  /** The field it shows (`shapioAttr`), for visual editing. */
  visual?: ShapioAttributes;
};

/** Shapio's rich text arrives with a sanitised `html` rendering next to the JSON document. */
export const RichText = ({ value, className = 'prose', visual }: RichTextProps) =>
  value ? <div className={className} {...visual} dangerouslySetInnerHTML={{ __html: value.html }} /> : null;
