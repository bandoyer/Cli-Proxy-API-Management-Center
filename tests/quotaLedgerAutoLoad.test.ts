import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { LEDGER_AUTO_LOAD_ADAPTERS, selectLedgerAutoLoad } from '@/features/quota/ledger/autoLoad';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import { apiCallApi, type ApiCallRequest, type ApiCallResult } from '@/services/api';
import { XAI_API_CHAT_URL, XAI_BILLING_MONTHLY_URL, XAI_BILLING_WEEKLY_URL } from '@/utils/quota';

const t = ((key: string) => key) as unknown as TFunction;
const originalApiCallRequest = apiCallApi.request;

const result = (statusCode: number, body: unknown = null): ApiCallResult => ({
  statusCode,
  header: {},
  bodyText: body === null ? '' : JSON.stringify(body),
  body,
});

const entry = (type: QuotaFileEntry['type'], name = `${type}.json`): QuotaFileEntry => ({
  type,
  file: { name, type, auth_index: `${type}:1` },
});

describe('opening the page loads every Claude, Codex and xAI quota reading once', () => {
  test('selects only credentials whose reading is not loaded yet', () => {
    const entries = [
      entry('claude', 'claude-idle.json'),
      entry('claude', 'claude-loaded.json'),
      entry('codex', 'codex-failed.json'),
      entry('codex', 'codex-idle.json'),
      entry('xai', 'xai-idle.json'),
      entry('xai', 'xai-loading.json'),
      entry('kimi', 'kimi-idle.json'),
      entry('devin', 'devin-idle.json'),
    ];
    const states: Record<string, QuotaCardState['status']> = {
      'claude-loaded.json': 'success',
      'codex-failed.json': 'error',
      'xai-loading.json': 'loading',
    };
    const getQuota = (e: QuotaFileEntry): QuotaCardState | undefined =>
      states[e.file.name] ? { status: states[e.file.name] } : undefined;

    expect(selectLedgerAutoLoad(entries, getQuota).map((e) => e.file.name)).toEqual([
      'claude-idle.json',
      'codex-idle.json',
      'xai-idle.json',
    ]);
  });
});

describe('the automatic xAI load', () => {
  afterEach(() => {
    apiCallApi.request = originalApiCallRequest;
  });

  const recordRequests = (respond: (request: ApiCallRequest) => ApiCallResult) => {
    const requests: ApiCallRequest[] = [];
    apiCallApi.request = async (request) => {
      requests.push(request);
      return respond(request);
    };
    return requests;
  };

  test('reads only the billing endpoint, even for a paid credential', async () => {
    const requests = recordRequests(() => result(200, { config: {} }));
    const paid = {
      name: 'paid.json',
      type: 'xai',
      auth_index: 'xai:1',
      using_api: true,
      prefix: 'paid',
    };

    await LEDGER_AUTO_LOAD_ADAPTERS.xai.fetchQuota(paid, t).catch(() => undefined);

    expect(requests.map((request) => request.url).sort()).toEqual(
      [XAI_BILLING_MONTHLY_URL, XAI_BILLING_WEEKLY_URL].sort()
    );
  });

  test('never falls back to a chat completion when billing fails', async () => {
    const requests = recordRequests(() => result(500, { error: 'down' }));

    await expect(
      LEDGER_AUTO_LOAD_ADAPTERS.xai.fetchQuota(entry('xai').file, t)
    ).rejects.toBeDefined();

    expect(requests.map((request) => request.url)).not.toContain(XAI_API_CHAT_URL);
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  test('a click still uses the full xAI load with its chat-completion fallback', async () => {
    const requests = recordRequests((request) =>
      request.url === XAI_API_CHAT_URL ? result(200, { choices: [] }) : result(500)
    );

    await QUOTA_ADAPTERS.xai.fetchQuota(entry('xai').file, t).catch(() => undefined);

    expect(requests.map((request) => request.url)).toContain(XAI_API_CHAT_URL);
    expect(LEDGER_AUTO_LOAD_ADAPTERS.claude).toBe(QUOTA_ADAPTERS.claude);
    expect(LEDGER_AUTO_LOAD_ADAPTERS.codex).toBe(QUOTA_ADAPTERS.codex);
  });
});
