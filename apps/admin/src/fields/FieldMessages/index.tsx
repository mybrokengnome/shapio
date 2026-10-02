import type { FieldDefinition } from '@shapio/schema';
import type { FieldControlState } from '../hooks/useFieldControl';

type FieldMessagesProps = { field: FieldDefinition; control: FieldControlState };

/** A field's description (written by the model's author, always visible) and its inline errors. */
export const FieldMessages = ({ field, control }: FieldMessagesProps) => (
  <>
    {field.description ? (
      <p id={control.descriptionId} className="text-meta text-muted-foreground">
        {field.description}
      </p>
    ) : null}
    {control.messages.length > 0 ? (
      <ul id={control.errorsId} className="space-y-0.5 text-meta font-medium text-destructive">
        {control.messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    ) : null}
  </>
);
