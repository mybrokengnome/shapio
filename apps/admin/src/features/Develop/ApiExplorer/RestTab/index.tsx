import { isModelDefinition, routeKeyOf } from '@shapio/schema';
import { useMemo } from 'react';
import { useAllDefinitions } from '@/api/schema';
import { withSiteParameter } from '@/helpers/sites';
import { useDeliverySiteKey } from '@/hooks/useDeliverySiteKey';
import { EndpointNav } from '../EndpointNav';
import type { DeliveryOperation, OperationGroup } from '../helpers/operations';
import { isSendable, requestPath, type RequestDraft } from '../helpers/request';
import { absoluteApiUrl, useSendRequest } from '../hooks/useSendRequest';
import { RequestBuilder } from '../RequestBuilder';
import { ResponseView } from '../ResponseView';
import { ShapePanel } from '../ShapePanel';
import { Snippets } from '../Snippets';
import { useExplorerTokenStore } from '../stores/token';

type RestTabProps = {
  groups: readonly OperationGroup[];
  operation: DeliveryOperation;
  /** The operation's request builder values (kept by the explorer, shared with the GraphQL tab). */
  draft: RequestDraft;
  onDraftChange: (draft: RequestDraft) => void;
};

/** REST: endpoints per place, the request builder, the snippets, the live response and the shape. */
export const RestTab = ({ groups, operation, draft, onDraftChange }: RestTabProps) => {
  const token = useExplorerTokenStore((state) => state.token);
  const send = useSendRequest();
  const { definitions } = useAllDefinitions();
  const model = useMemo(
    () =>
      definitions
        ?.map(({ definition }) => definition)
        .filter(isModelDefinition)
        .find((candidate) => routeKeyOf(candidate) === operation.routeKey),
    [definitions, operation.routeKey],
  );
  const siteKey = useDeliverySiteKey();
  // A site other than the primary one is named in the URL, as a site's own requests would (sites plan §H).
  const path = withSiteParameter(requestPath(operation, draft), siteKey);
  // The last response belongs to the operation it was sent for.
  const response = send.data && send.variables?.operationId === operation.id ? send.data : undefined;
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <EndpointNav groups={groups} selectedId={operation.id} />
      <div className="grid min-w-0 flex-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <RequestBuilder
            operation={operation}
            draft={draft}
            onDraftChange={onDraftChange}
            path={path}
            sendable={isSendable(operation, draft)}
            sending={send.isPending}
            onSend={() => send.mutate({ operationId: operation.id, path, token })}
          />
          <Snippets url={absoluteApiUrl(path)} withToken={token !== ''} />
          <ResponseView response={response} modelKey={model?.apiKey} />
        </div>
        {model ? <ShapePanel model={model} /> : null}
      </div>
    </div>
  );
};
