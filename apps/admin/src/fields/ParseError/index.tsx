type ParseErrorProps = { id: string; message: string | undefined };

/** An editor's own "this text can't be read" message (the value is not sent until it parses). */
export const ParseError = ({ id, message }: ParseErrorProps) =>
  message ? (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
