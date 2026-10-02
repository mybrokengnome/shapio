import { cva } from 'class-variance-authority';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import { Logo } from '../Logo';

const wordmarkVariants = cva('inline-flex items-center', {
  variants: {
    size: {
      /** Sidebar and auth screens: 28px mark. */
      default: 'gap-2 [&>span]:text-xl [&>svg]:size-7',
      /** Status bar and the phone header: 16px mark. */
      sm: 'gap-1.5 [&>span]:text-sm [&>svg]:size-4',
    },
  },
  defaultVariants: { size: 'default' },
});

type WordmarkProps = { size?: 'default' | 'sm'; className?: string };

/** Mark + "shapio" in Manrope ExtraBold, as in the brand sheet. Ink on light, ivory on dark. */
export const Wordmark = ({ size, className }: WordmarkProps) => {
  const { t } = useTranslation();
  return (
    <span className={cn(wordmarkVariants({ size }), className)}>
      <Logo />
      <span className="font-extrabold tracking-tight text-ink lowercase dark:text-ivory">
        {t('app.name')}
      </span>
    </span>
  );
};
