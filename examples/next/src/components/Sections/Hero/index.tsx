import { safeHref } from '../../../lib/site';
import type { HeroSection } from '../../../lib/types';
import { ResponsiveImage } from '../../ResponsiveImage';

type HeroProps = { section: HeroSection; isFirst: boolean };

export const Hero = ({ section, isFirst }: HeroProps) => {
  const Heading = isFirst ? 'h1' : 'h2';
  return (
    <section className="hero">
      <div className="hero-text">
        <Heading>{section.heading}</Heading>
        {section.subheading ? <p className="lead">{section.subheading}</p> : null}
        {section.ctaLabel && section.ctaUrl ? (
          <a className="button" href={safeHref(section.ctaUrl)}>
            {section.ctaLabel}
          </a>
        ) : null}
      </div>
      {section.image ? (
        <ResponsiveImage
          media={section.image}
          sizes="(min-width: 64rem) 50vw, 100vw"
          eager={isFirst}
          className="hero-image"
        />
      ) : null}
    </section>
  );
};
