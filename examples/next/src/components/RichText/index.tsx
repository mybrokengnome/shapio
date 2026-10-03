import type { RichText as RichTextValue } from '../../lib/types';

type RichTextProps = { value: RichTextValue | null; className?: string };

/** Shapio's rich text arrives with a sanitised `html` rendering next to the JSON document. */
export const RichText = ({ value, className = 'prose' }: RichTextProps) =>
  value ? <div className={className} dangerouslySetInnerHTML={{ __html: value.html }} /> : null;
