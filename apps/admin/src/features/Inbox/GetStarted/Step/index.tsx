import { Link, type LinkOptions } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';

type StepProps = {
  title: string;
  /** One line: what the step gets you. */
  description: string;
  action: string;
  link: LinkOptions;
  done: boolean;
};

/**
 * One numbered row of "Get started" (the number comes from the list's CSS counter): a tick and "Done" once
 * it is done, otherwise the button that does it.
 */
export const Step = ({ title, description, action, link, done }: StepProps) => {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 [counter-increment:step] sm:flex-nowrap">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums',
          done
            ? 'border-transparent bg-success-muted text-success'
            : 'text-muted-foreground before:content-[counter(step)]',
        )}
      >
        {done ? <Check className="size-4" /> : null}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p id={titleId} className={cn('text-sm font-semibold', done && 'text-muted-foreground')}>
          {title}
        </p>
        <p className="text-meta text-muted-foreground">{description}</p>
      </div>
      {/* On phones the action goes under the text, lined up with it. */}
      <div className="basis-full pl-12 sm:basis-auto sm:pl-0">
        {done ? (
          <StatusChip tone="success" label={t('inbox.getStarted.done')} />
        ) : (
          <Button variant="outline" size="sm" asChild>
            <Link {...link} aria-describedby={titleId}>
              {action}
            </Link>
          </Button>
        )}
      </div>
    </li>
  );
};
