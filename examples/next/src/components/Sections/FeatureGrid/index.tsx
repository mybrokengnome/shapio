import type { FeatureGridSection } from '../../../lib/types';

type FeatureGridProps = { section: FeatureGridSection };

export const FeatureGrid = ({ section }: FeatureGridProps) => (
  <section className="features">
    {section.heading ? <h2>{section.heading}</h2> : null}
    <ul className="feature-grid">
      {section.features.map((feature) => (
        <li key={feature.title}>
          <h3>{feature.title}</h3>
          {feature.description ? <p>{feature.description}</p> : null}
        </li>
      ))}
    </ul>
  </section>
);
