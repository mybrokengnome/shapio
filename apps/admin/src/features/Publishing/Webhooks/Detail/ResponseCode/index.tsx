import { StatusChip, type StatusTone } from '@/components/StatusChip';

type ResponseCodeProps = { status: number; label?: string };

const SUCCESS_MIN = 200;
const REDIRECT_MIN = 300;
const CLIENT_ERROR_MIN = 400;

const toneOf = (status: number): StatusTone =>
  status >= SUCCESS_MIN && status < REDIRECT_MIN
    ? 'success'
    : status < CLIENT_ERROR_MIN
      ? 'warning'
      : 'danger';

/** An HTTP response code as a chip: 2xx green, 3xx amber, 4xx and 5xx red. */
export const ResponseCode = ({ status, label }: ResponseCodeProps) => (
  <StatusChip tone={toneOf(status)} label={label ?? String(status)} size="sm" className="font-mono" />
);
