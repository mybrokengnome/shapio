import { safeHref } from '../../../lib/site';
import type { CallToActionSection } from '../../../lib/types';

type CallToActionProps = { section: CallToActionSection };

export const CallToAction = ({ section }: CallToActionProps) => (
  <section className="cta">
    <h2>{section.heading}</h2>
    {section.text ? <p>{section.text}</p> : null}
    <a className="button" href={safeHref(section.buttonUrl)}>
      {section.buttonLabel}
    </a>
  </section>
);
