import { useTranslation } from 'react-i18next';
import { SubNav, SubNavGroup } from '@/components/SubNav';
import { SubNavLink } from '@/components/SubNavLink';
import { DELIVERY_PREFIX, type OperationGroup } from '../helpers/operations';

/** Delivery endpoints are reads; the method is code, not text to translate. */
const METHOD = 'GET';

type EndpointNavProps = { groups: readonly OperationGroup[]; selectedId: string | undefined };

/** Delivery endpoints per place (model), from the live OpenAPI document. */
export const EndpointNav = ({ groups, selectedId }: EndpointNavProps) => {
  const { t } = useTranslation();
  return (
    <SubNav label={t('develop.api.endpoints')}>
      {groups.map((group) => (
        <SubNavGroup key={group.tag} label={group.tag}>
          {group.operations.map((operation) => (
            <SubNavLink
              key={operation.id}
              to="/api-explorer"
              search={{ tab: 'rest', op: operation.id }}
              title={operation.summary}
              aria-current={operation.id === selectedId ? 'page' : undefined}
            >
              <span className="font-mono text-2xs font-semibold text-muted-foreground">{METHOD}</span>
              <span className="min-w-0 truncate font-mono text-xs">
                {operation.path.slice(DELIVERY_PREFIX.length - 1)}
              </span>
            </SubNavLink>
          ))}
        </SubNavGroup>
      ))}
    </SubNav>
  );
};
