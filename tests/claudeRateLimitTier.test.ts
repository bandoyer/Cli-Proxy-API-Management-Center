import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { apiCallApi, type ApiCallResult } from '@/services/api';
import { CLAUDE_PROFILE_URL } from '@/utils/quota';

const t = ((key: string) => key) as unknown as TFunction;
const originalApiCallRequest = apiCallApi.request;

const result = (body: unknown): ApiCallResult => ({
  statusCode: 200,
  header: {},
  bodyText: JSON.stringify(body),
  body,
});

describe('Claude quota reading keeps the profile rate_limit_tier', () => {
  afterEach(() => {
    apiCallApi.request = originalApiCallRequest;
  });

  test('from the profile organization into the quota state', async () => {
    apiCallApi.request = async (request) =>
      request.url === CLAUDE_PROFILE_URL
        ? result({
            account: { has_claude_max: true },
            organization: { rate_limit_tier: 'default_claude_max_20x' },
          })
        : result({ seven_day: { utilization: 25, resets_at: '2026-10-10T12:18:00Z' } });

    const data = await CLAUDE_CONFIG.fetchQuota({ name: 'claude.json', auth_index: 'c:1' }, t);
    const state = CLAUDE_CONFIG.buildSuccessState(data);

    expect(state.planType).toBe('plan_max');
    expect(state.rateLimitTier).toBe('default_claude_max_20x');
  });
});
