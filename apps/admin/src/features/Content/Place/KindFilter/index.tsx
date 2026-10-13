import type { ResolvedModelDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddChip } from '../AddChip';

type KindFilterProps = {
  /** The place's type and its kinds, in tree order. */
  kinds: readonly ResolvedModelDefinition[];
  onPick: (kind: string) => void;
};

/**
 * "+ Kind": only entries of one kind: the place's type alone, or another kind and the kinds that extend it.
 */
export const KindFilter = ({ kinds, onPick }: KindFilterProps) => {
  const { t } = useTranslation();
  return (
    <li>
      {/* Not modal: the page behind isn't hidden from assistive technology while the short list is open. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <AddChip>{t('place.filters.kind')}</AddChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {kinds.map((kind) => (
            <DropdownMenuItem key={kind.id} onSelect={() => onPick(kind.apiKey)}>
              {kind.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};
