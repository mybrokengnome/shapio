import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/helpers/cn';

type CodeBlockProps = {
  code: string;
  /** Names the block (a visible caption and the scrollable region's accessible name). */
  label: string;
  /** Show a copy button beside the caption. */
  copyable?: boolean;
  className?: string;
};

/**
 * Read-only code (JSON, SDL, TypeScript, curl) in a scrollable, keyboard-focusable block with a caption
 * and an optional copy button.
 */
export const CodeBlock = ({ code, label, copyable = true, className }: CodeBlockProps) => (
  <div className={cn('min-w-0 space-y-2', className)}>
    <div className="flex min-h-9 items-center justify-between gap-2">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      {copyable ? <CopyButton value={code} /> : null}
    </div>
    <pre
      role="region"
      aria-label={label}
      tabIndex={0}
      className="max-h-[28rem] overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs leading-5 text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <code>{code}</code>
    </pre>
  </div>
);
