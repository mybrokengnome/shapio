import type { ResolvedModelDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/helpers/cn';

type NewButtonProps = {
  /** The place's type. */
  model: ResolvedModelDefinition;
  /** The kinds the admin may create, the place's type first when it is one of them (tree order). */
  kinds: readonly ResolvedModelDefinition[];
  locale: string | null;
};

/** Indentation of a kind in the menu by how far below the place's type it sits. */
const DEPTH_CLASSES = ['', 'pl-6', 'pl-9', 'pl-12'] as const;

const depthClassOf = (kind: ResolvedModelDefinition, model: ResolvedModelDefinition) =>
  DEPTH_CLASSES[Math.min(kind.ancestorIds.length - model.ancestorIds.length, DEPTH_CLASSES.length - 1)];

/**
 * "New" for a place: opens a new entry in the list's locale. A place whose type has kinds offers a menu of
 * the kinds the admin may create (the type itself first, then its kinds in tree order); with one, a plain
 * button.
 */
export const NewButton = ({ model, kinds, locale }: NewButtonProps) => {
  const { t } = useTranslation();
  const search = locale ? { locale } : {};
  const [only] = kinds;
  if (!only) {
    return null;
  }
  if (kinds.length === 1) {
    return (
      <Button asChild>
        <Link to="/content/$modelKey/new" params={{ modelKey: only.apiKey }} search={search}>
          <Plus aria-hidden="true" />
          {only.id === model.id ? t('place.new') : t('place.newKind', { kind: only.label })}
        </Link>
      </Button>
    );
  }
  // Not modal: the page behind isn't hidden from assistive technology while the short list is open.
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus aria-hidden="true" />
          {t('place.new')}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>{t('place.newMenu')}</DropdownMenuLabel>
        {kinds.map((kind) => (
          <DropdownMenuItem key={kind.id} asChild className={cn(depthClassOf(kind, model))}>
            <Link to="/content/$modelKey/new" params={{ modelKey: kind.apiKey }} search={search}>
              {kind.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
