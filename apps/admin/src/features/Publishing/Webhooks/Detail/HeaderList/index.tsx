type HeaderListProps = { headers: Record<string, string>; label: string };

/** HTTP headers as name: value lines. */
export const HeaderList = ({ headers, label }: HeaderListProps) => (
  <dl aria-label={label} className="space-y-0.5 rounded-md border bg-muted p-2 font-mono text-xs break-all">
    {Object.entries(headers).map(([name, value]) => (
      <div key={name}>
        <dt className="inline font-semibold">{name}</dt>
        <dd className="inline before:content-[':_']">{value}</dd>
      </div>
    ))}
  </dl>
);
