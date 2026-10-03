import type { Section } from '../../../lib/types';
import { CallToAction } from '../CallToAction';
import { FeatureGrid } from '../FeatureGrid';
import { Gallery } from '../Gallery';
import { Hero } from '../Hero';

type SectionViewProps = { section: Section; index: number };

export const SectionView = ({ section, index }: SectionViewProps) => {
  switch (section.__component) {
    case 'hero':
      return <Hero section={section} isFirst={index === 0} />;
    case 'featureGrid':
      return <FeatureGrid section={section} />;
    case 'gallery':
      return <Gallery section={section} />;
    case 'callToAction':
      return <CallToAction section={section} />;
    default:
      // A section type this site does not know yet (added in Shapio after the last deploy): skipped.
      return null;
  }
};
