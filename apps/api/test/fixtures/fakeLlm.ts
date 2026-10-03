import { startFakeJsonServer, type FakeRequest } from './fakeJsonServer.js';

/**
 * A loopback model provider speaking the three wire formats assist supports: the Messages API
 * (`POST /v1/messages`, anthropic) and Chat Completions (`POST /v1/chat/completions`, openai and
 * openai-compatible). Tests decide each answer with `respond`; every call is recorded, parsed.
 */
export type FakeLlmCall = {
  format: 'messages' | 'chat';
  headers: FakeRequest['headers'];
  body: Record<string, unknown>;
  system: string;
  /** The text of the last user message (a repair turn's correction). */
  userText: string;
  /** The text of the first user message (the task). */
  firstUserText: string;
  /** Messages in the conversation, system excluded (2 more on a repair turn). */
  turns: number;
  /** Number of images attached to the last user message. */
  images: number;
  /** The JSON Schema the request asked for natively (`output_config` or `response_format`), if any. */
  schema: unknown;
};

export type FakeLlmReply = { text: string; refusal?: boolean } | { status: number; message: string };
export type FakeLlmResponder = (call: FakeLlmCall, index: number) => FakeLlmReply;

type Part = { type?: string; text?: string };
type Message = { role?: string; content?: string | Part[] };

const textOf = (content: Message['content']): string =>
  typeof content === 'string'
    ? content
    : (content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('');

const imagesOf = (content: Message['content']): number =>
  typeof content === 'string'
    ? 0
    : (content ?? []).filter((part) => part.type === 'image' || part.type === 'image_url').length;

const parseCall = (request: FakeRequest): FakeLlmCall => {
  const body = JSON.parse(request.body) as Record<string, unknown>;
  const messages = (body.messages ?? []) as Message[];
  const format = request.path.endsWith('/messages') ? 'messages' : 'chat';
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const system =
    format === 'messages'
      ? typeof body.system === 'string'
        ? body.system
        : ''
      : textOf(messages.find((message) => message.role === 'system')?.content);
  const outputConfig = body.output_config as { format?: { schema?: unknown } } | undefined;
  const responseFormat = body.response_format as { json_schema?: { schema?: unknown } } | undefined;
  return {
    format,
    headers: request.headers,
    body,
    system,
    userText: textOf(lastUser?.content),
    firstUserText: textOf(messages.find((message) => message.role === 'user')?.content),
    turns: messages.filter((message) => message.role !== 'system').length,
    images: imagesOf(lastUser?.content),
    schema: outputConfig?.format?.schema ?? responseFormat?.json_schema?.schema,
  };
};

const USAGE = { input: 11, output: 7 };

const answer = (call: FakeLlmCall, reply: FakeLlmReply) => {
  const model = typeof call.body.model === 'string' ? call.body.model : 'fake';
  if ('status' in reply) {
    return {
      status: reply.status,
      body:
        call.format === 'messages'
          ? { type: 'error', error: { type: 'invalid_request_error', message: reply.message } }
          : { error: { message: reply.message, type: 'invalid_request_error' } },
    };
  }
  if (call.format === 'messages') {
    return {
      status: 200,
      body: {
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model,
        content: reply.refusal ? [] : [{ type: 'text', text: reply.text }],
        stop_reason: reply.refusal ? 'refusal' : 'end_turn',
        usage: { input_tokens: USAGE.input, output_tokens: USAGE.output },
      },
    };
  }
  return {
    status: 200,
    body: {
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      model,
      choices: [
        {
          index: 0,
          message: reply.refusal
            ? { role: 'assistant', content: null, refusal: 'declined' }
            : { role: 'assistant', content: reply.text },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: USAGE.input, completion_tokens: USAGE.output },
    },
  };
};

export const FAKE_LLM_USAGE = USAGE;

export const startFakeLlm = async (initial: FakeLlmResponder = () => ({ text: 'ok' })) => {
  let respond = initial;
  const calls: FakeLlmCall[] = [];
  const server = await startFakeJsonServer((request) => {
    if (request.method !== 'POST' || !/\/v1\/(messages|chat\/completions)$/.test(request.path)) {
      return { status: 404, body: { error: { message: `no route ${request.path}` } } };
    }
    const call = parseCall(request);
    calls.push(call);
    return answer(call, respond(call, calls.length - 1));
  });
  return {
    /** For AI_BASE_URL. */
    baseUrl: `${server.url}/v1`,
    calls,
    respondWith: (next: FakeLlmResponder) => {
      respond = next;
    },
    reset: () => {
      calls.length = 0;
    },
    close: server.close,
  };
};

export type FakeLlm = Awaited<ReturnType<typeof startFakeLlm>>;

/** The segments a translate request sent (the JSON inside its <content> block). */
export const segmentsOf = (call: FakeLlmCall): { id: string; text: string; maxLength?: number }[] => {
  const json = /<content>\n([\s\S]*)\n<\/content>/.exec(call.firstUserText)?.[1] ?? '[]';
  return JSON.parse(json) as { id: string; text: string; maxLength?: number }[];
};
