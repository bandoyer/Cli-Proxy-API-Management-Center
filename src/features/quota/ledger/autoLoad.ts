/**
 * The quota ledger's automatic load when the page opens.
 *
 * The summary cards need every Claude, Codex and xAI quota reading, so each
 * one not loaded yet is loaded once. xAI's automatic load reads only the
 * billing endpoint: the stock chat-completion fallback spends tokens, so it
 * runs only when the user clicks refresh.
 */

import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaAdapter, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { fetchXaiBillingQuota } from '../providers/xai/data';
import { LEDGER_PROVIDERS } from './model';

export const LEDGER_AUTO_LOAD_ADAPTERS: Record<QuotaProviderType, QuotaAdapter> = {
  ...QUOTA_ADAPTERS,
  xai: { ...QUOTA_ADAPTERS.xai, fetchQuota: fetchXaiBillingQuota },
};

/** Ledger credentials whose quota reading has not been requested yet. */
export function selectLedgerAutoLoad(
  entries: QuotaFileEntry[],
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined
): QuotaFileEntry[] {
  return entries.filter(
    (entry) =>
      LEDGER_PROVIDERS.includes(entry.type) &&
      !entry.file.disabled &&
      (getQuota(entry)?.status ?? 'idle') === 'idle'
  );
}
