import type { Page } from '../../lib/types';
import { SectionView } from './SectionView';

type SectionsProps = { page: Pick<Page, 'title' | 'sections' | 'locale'> };

/** A page's dynamic zone. The page title is the heading when the page does not open with a hero. */
export const Sections = ({ page }: SectionsProps) => (
  <div lang={page.locale}>
    {page.sections[0]?.__component === 'hero' ? null : <h1 className="page-title">{page.title}</h1>}
    {page.sections.map((section, index) => (
      <SectionView key={`${section.__component}-${index}`} section={section} index={index} />
    ))}
  </div>
);
