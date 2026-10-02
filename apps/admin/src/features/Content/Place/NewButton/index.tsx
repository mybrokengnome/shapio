import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

type NewButtonProps = { modelKey: string; locale: string | null };

/** "New" for a place: opens a new entry in the list's locale. */
export const NewButton = ({ modelKey, locale }: NewButtonProps) => {
  const { t } = useTranslation();
  return (
    <Button asChild>
      <Link to="/content/$modelKey/new" params={{ modelKey }} search={locale ? { locale } : {}}>
        <Plus aria-hidden="true" />
        {t('place.new')}
      </Link>
    </Button>
  );
};
