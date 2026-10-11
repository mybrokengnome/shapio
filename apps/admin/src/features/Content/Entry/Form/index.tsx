import { effectiveFormLayout, type ModelDefinition } from '@shapio/schema';
import { useMemo } from 'react';
import { Title } from '../Title';
import { Section } from './Section';

type FormBodyProps = {
  model: ModelDefinition;
  heading: string;
};

/**
 * A form-layout entry's page (`display.layout: 'form'`): the title as a read-only heading, then every field
 * on the page at its width, in sections from the display groups (`effectiveFormLayout`). The title is one of
 * the fields. No cover, strip, canvas or property grid.
 */
export const FormBody = ({ model, heading }: FormBodyProps) => {
  const layout = useMemo(() => effectiveFormLayout(model), [model]);
  return (
    <>
      <Title field={undefined} heading={heading} variant="form" />
      {layout.sections.map((section, index) => (
        <Section
          key={section.id}
          section={section}
          // Runs of ungrouped fields never touch, so a section after the first follows a group or is one.
          spaced={index > 0 && section.label === undefined}
        />
      ))}
    </>
  );
};
