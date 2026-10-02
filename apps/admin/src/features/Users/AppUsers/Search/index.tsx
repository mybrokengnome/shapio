import { Search as SearchIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { useSearchInput } from '@/hooks/useSearchInput';

type SearchProps = { query: string | undefined; onQueryChange: (query: string | undefined) => void };

/** Searches app users by email or name; the URL updates once typing pauses. */
export const Search = ({ query, onQueryChange }: SearchProps) => {
  const { t } = useTranslation();
  const { text, setText } = useSearchInput(query, onQueryChange);
  return (
    <div className="relative w-full sm:w-72">
      <SearchIcon
        aria-hidden="true"
        className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label={t('appUsers.search')}
        placeholder={t('appUsers.searchPlaceholder')}
        inputSize="sm"
        className="pl-8"
      />
    </div>
  );
};
