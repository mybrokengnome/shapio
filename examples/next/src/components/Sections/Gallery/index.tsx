import type { GallerySection } from '../../../lib/types';
import { ResponsiveImage } from '../../ResponsiveImage';

type GalleryProps = { section: GallerySection };

export const Gallery = ({ section }: GalleryProps) => (
  <section className="gallery">
    {section.heading ? <h2>{section.heading}</h2> : null}
    <ul className="gallery-grid">
      {section.images.map((image) => (
        <li key={image.id}>
          <figure>
            <ResponsiveImage media={image} sizes="(min-width: 48rem) 33vw, 100vw" />
            {image.caption ? <figcaption>{image.caption}</figcaption> : null}
          </figure>
        </li>
      ))}
    </ul>
  </section>
);
