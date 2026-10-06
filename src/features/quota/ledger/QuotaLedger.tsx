/**
 * Quota ledger: one summary card per provider over one panel per provider.
 *
 * Covers Claude, Codex and xAI (LEDGER_PROVIDERS). Each card headlines the
 * longest quota window with its total across the provider's credentials;
 * each panel has one column per window and one row per credential.
 */

import { useId, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPencil, IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { QuotaMeter } from '../components/QuotaMeter';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import type { QuotaClassMap } from '../types';
import { formatRenewal, formatWhen } from './format';
import {
  LEDGER_PROVIDERS,
  buildLedgerRow,
  parseRenewalDayInput,
  summarizeLedger,
  type LedgerRow,
  type LedgerSummary,
  type LedgerWindowTotal,
} from './model';
import styles from './QuotaLedger.module.scss';

/** QuotaMeter reads only the bar classes; the ledger styles them with the stock tokens. */
const quotaClasses = {
  quotaBar: styles.quotaBar,
  quotaBarFill: styles.quotaBarFill,
  quotaBarFillHigh: styles.quotaBarFillHigh,
  quotaBarFillMedium: styles.quotaBarFillMedium,
  quotaBarFillLow: styles.quotaBarFillLow,
} as QuotaClassMap;

export interface QuotaLedgerProps {
  /** Claude, Codex and xAI credentials, in display order. */
  entries: QuotaFileEntry[];
  getQuota: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  resettingQuotaName: string | null;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
  /** Saves (or, with null, clears) the renewal day; resolves true on success. */
  onSaveRenewalDay: (entry: QuotaFileEntry, day: number | null) => Promise<boolean>;
  /** Fixed clock for static rendering tests. */
  now?: number;
}

type Summary = LedgerSummary<LedgerRow>;

const pct = (value: number | null) => (value === null ? '--' : `${Math.round(value)}%`);

function When({ atMs, now }: { atMs: number | null; now: number }) {
  const { t, i18n } = useTranslation();
  if (atMs === null) {
    return (
      <span className={`${styles.when} ${styles.muted}`}>
        {t('quota_management.ledger.no_reset')}
      </span>
    );
  }
  return <span className={styles.when}>{formatWhen(atMs, now, i18n.resolvedLanguage)}</span>;
}

function Segments({ values }: { values: (number | null)[] }) {
  return (
    <div className={styles.segments}>
      {values.map((value, index) => (
        <div key={index} className={styles.segment}>
          <QuotaMeter percent={value} classes={quotaClasses} />
        </div>
      ))}
    </div>
  );
}

function Total({ total, big = false }: { total: LedgerWindowTotal; big?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={big ? styles.bigNumber : styles.midNumber}>
      {pct(total.sumLeft)}{' '}
      <span className={styles.muted}>
        {t('quota_management.ledger.of_total', { total: total.outOf })}
      </span>
    </div>
  );
}

function ProviderIcon({ type, theme }: { type: QuotaProviderType; theme: ResolvedTheme }) {
  const src = getAuthFileIcon(type, theme);
  if (!src) return null;
  return (
    <span
      className={styles.iconWrap}
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(theme) }
          : undefined
      }
    >
      <img src={src} alt="" className={styles.icon} />
    </span>
  );
}

/* ---------- summary cards ---------- */

function SummaryCard({
  summary,
  theme,
  now,
}: {
  summary: Summary;
  theme: ResolvedTheme;
  now: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const headline = summary.headline;
  const others = summary.totals
    .filter((total) => total !== headline)
    .sort((a, b) => (b.periodHours ?? 0) - (a.periodHours ?? 0));

  return (
    <section className={styles.summaryCard} aria-label={getTypeLabel(t, summary.type)}>
      <div className={styles.summaryHead}>
        <ProviderIcon type={summary.type} theme={theme} />
        <strong>{getTypeLabel(t, summary.type)}</strong>
        <span className={styles.muted}>
          {t('quota_management.meta_credentials', { count: summary.rows.length })}
        </span>
      </div>
      {headline ? (
        <>
          <div className={styles.muted}>{headline.label}</div>
          <Total total={headline} big />
          <Segments values={headline.segments} />
          <When atMs={headline.soonestResetMs} now={now} />
          {others.length > 0 && (
            <div className={styles.summaryOthers}>
              {!open && (
                <span>
                  <span className={styles.muted}>{others[0].label}</span>{' '}
                  <strong>{pct(others[0].sumLeft)}</strong>
                </span>
              )}
              <button
                type="button"
                className={styles.linkButton}
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => setOpen(!open)}
              >
                {t(open ? 'quota_management.ledger.hide' : 'quota_management.ledger.show')}
              </button>
              <div id={listId} className={styles.summaryOtherList} hidden={!open}>
                {open &&
                  others.map((other) => (
                    <div key={other.id} className={styles.summaryOther}>
                      <div className={styles.windowHead}>
                        <span className={styles.muted}>{other.label}</span>
                        <Total total={other} />
                      </div>
                      <Segments values={other.segments} />
                      <When atMs={other.soonestResetMs} now={now} />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className={styles.muted}>{t('quota_management.ledger.no_readings')}</div>
      )}
    </section>
  );
}

/* ---------- plan line and renewal day ---------- */

function RenewalDayForm({
  row,
  onSave,
  onClose,
}: {
  row: LedgerRow;
  onSave: (day: number | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const [text, setText] = useState(row.renewalDay === null ? '' : String(row.renewalDay));
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (day: number | null) => {
    setSaving(true);
    const saved = await onSave(day);
    setSaving(false);
    if (saved) onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseRenewalDayInput(text);
    setInvalid(!parsed.ok);
    if (parsed.ok) void save(parsed.day);
  };

  return (
    <form className={styles.renewalForm} onSubmit={submit}>
      <label htmlFor={inputId} className={styles.muted}>
        {t('quota_management.ledger.renewal_day_label')}
      </label>
      <input
        id={inputId}
        className={styles.renewalInput}
        type="number"
        inputMode="numeric"
        min={1}
        max={31}
        step={1}
        value={text}
        autoFocus
        aria-invalid={invalid}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      />
      <button type="submit" className={styles.action} disabled={saving}>
        {t('common.save')}
      </button>
      {row.renewalDay !== null && (
        <button
          type="button"
          className={styles.action}
          disabled={saving}
          onClick={() => void save(null)}
        >
          {t('quota_management.ledger.clear')}
        </button>
      )}
      <button type="button" className={styles.action} disabled={saving} onClick={onClose}>
        {t('common.cancel')}
      </button>
      {invalid && (
        <span role="alert" className={styles.error}>
          {t('quota_management.ledger.renewal_day_invalid')}
        </span>
      )}
    </form>
  );
}

function PlanLine({
  row,
  now,
  canEdit,
  onSaveRenewalDay,
}: {
  row: LedgerRow;
  now: number;
  canEdit: boolean;
  onSaveRenewalDay: (day: number | null) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const offerInput = row.asksRenewalDay && canEdit;

  return (
    <div className={styles.plan}>
      {row.plan && <strong>{row.plan}</strong>}
      {row.renewal && (
        <span className={styles.muted}>
          {row.plan ? ' · ' : ''}
          {t('quota_management.ledger.renews', {
            when: formatRenewal(row.renewal, now, i18n.resolvedLanguage),
          })}
        </span>
      )}
      {offerInput && !editing && (
        <button
          type="button"
          className={`${styles.linkButton} ${styles.renewalEdit}`}
          onClick={() => setEditing(true)}
          aria-label={t(
            row.renewalDay === null
              ? 'quota_management.ledger.renewal_day_set'
              : 'quota_management.ledger.renewal_day_edit'
          )}
        >
          {row.renewalDay === null ? (
            t('quota_management.ledger.renewal_day_set')
          ) : (
            <IconPencil size={12} aria-hidden="true" />
          )}
        </button>
      )}
      {offerInput && editing && (
        <RenewalDayForm row={row} onSave={onSaveRenewalDay} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

/* ---------- provider panels ---------- */

function RowState({
  row,
  canRefresh,
  onRefresh,
}: {
  row: LedgerRow;
  canRefresh: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const prefix = QUOTA_ADAPTERS[row.entry.type].i18nPrefix;
  if (row.status === 'loading') {
    return (
      <span className={styles.muted} aria-busy="true">
        {t(`${prefix}.loading`)}
      </span>
    );
  }
  if (row.status === 'error') {
    const message = resolveQuotaErrorMessage(
      t,
      row.quota?.errorStatus,
      row.quota?.error || t('common.unknown_error')
    );
    return (
      <span role="alert" className={styles.error}>
        {t(`${prefix}.load_failed`, { message })}
      </span>
    );
  }
  return (
    <button type="button" className={styles.linkButton} onClick={onRefresh} disabled={!canRefresh}>
      {t(`${prefix}.idle`)}
    </button>
  );
}

function ExtraCell({ row, now }: { row: LedgerRow; now: number }) {
  const { t } = useTranslation();
  if (row.manualResets) {
    return (
      <div className={styles.windowCell}>
        <span className={styles.windowLabel}>{t('codex_quota.reset_credits_label')}</span>
        <span>
          <strong>{row.manualResets.count}</strong>{' '}
          <span className={styles.muted}>
            {t('quota_management.ledger.available', { count: row.manualResets.count })}
          </span>
        </span>
        {row.manualResets.firstExpiryMs !== null && (
          <span className={styles.small}>
            <span className={styles.muted}>{t('quota_management.ledger.first_expiry')} </span>
            <When atMs={row.manualResets.firstExpiryMs} now={now} />
          </span>
        )}
      </div>
    );
  }
  if (row.credits) {
    const dollars = (cents: number | null) =>
      cents === null ? '--' : `$${(cents / 100).toFixed(2)}`;
    return (
      <div className={styles.windowCell}>
        <span className={styles.windowLabel}>{t('xai_quota.monthly_credits')}</span>
        <span>
          <strong>{dollars(row.credits.usedCents)}</strong>{' '}
          <span className={styles.muted}>/ {dollars(row.credits.limitCents)}</span>
        </span>
      </div>
    );
  }
  return null;
}

function RowActions({
  row,
  canRefresh,
  resetting,
  onRefresh,
  onReset,
}: {
  row: LedgerRow;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[row.entry.type];
  const loading = row.status === 'loading';
  const showReset =
    row.status === 'success' &&
    Boolean(adapter.resetQuota) &&
    row.quota !== undefined &&
    Boolean(adapter.canResetQuota?.(row.quota));
  return (
    <div className={styles.actions}>
      {showReset && (
        <button
          type="button"
          className={styles.action}
          onClick={onReset}
          disabled={!canRefresh || loading || resetting}
        >
          <IconRefreshCw size={13} className={resetting ? styles.spinning : undefined} />
          {t('codex_quota.reset_button')}
        </button>
      )}
      <button
        type="button"
        className={styles.action}
        onClick={onRefresh}
        disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting)}
        title={t('auth_files.quota_refresh_hint')}
      >
        <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
        {t('auth_files.quota_refresh_single')}
      </button>
    </div>
  );
}

function ProviderPanel({
  summary,
  now,
  props,
}: {
  summary: Summary;
  now: number;
  props: QuotaLedgerProps;
}) {
  const { t } = useTranslation();
  const columns = summary.totals;
  const hasExtra = summary.rows.some((row) => row.manualResets || row.credits);
  const dataColumns = columns.length + (hasExtra ? 1 : 0);
  const grid: CSSProperties = {
    gridTemplateColumns: `minmax(220px, 1.4fr) repeat(${dataColumns}, minmax(150px, 1fr)) auto`,
  };

  return (
    <section className={styles.panel} aria-label={getTypeLabel(t, summary.type)}>
      <div className={styles.panelGrid} style={grid}>
        <div className={styles.panelHeadCell}>
          <div className={styles.summaryHead}>
            <ProviderIcon type={summary.type} theme={props.resolvedTheme} />
            <strong>{getTypeLabel(t, summary.type)}</strong>
          </div>
          <div className={styles.muted}>
            {t('quota_management.meta_credentials', { count: summary.rows.length })} ·{' '}
            {t('quota_management.ledger.total_left')}
          </div>
        </div>
        {columns.map((column) => {
          const isHeadline = column === summary.headline;
          return (
            <div
              key={column.id}
              className={`${styles.panelHeadCell} ${isHeadline ? styles.headlineCol : ''}`}
            >
              <div className={styles.windowHead}>
                <span className={styles.windowLabel}>{column.label}</span>
                {isHeadline && (
                  <span className={styles.headlineBadge}>
                    {t('quota_management.ledger.headline')}
                  </span>
                )}
              </div>
              <Total total={column} />
              <Segments values={column.segments} />
              <When atMs={column.soonestResetMs} now={now} />
            </div>
          );
        })}
        {hasExtra && <div className={styles.panelHeadCell} />}
        <div className={styles.panelHeadCell} />

        {summary.rows.map((row) => {
          const file = row.entry.file;
          const cacheKey = getQuotaCacheKey(file);
          const canRefresh = props.canRefresh && !file.disabled;
          const onRefresh = () => props.onRefresh(row.entry);
          return (
            <div key={cacheKey} className={styles.panelRow}>
              <div className={styles.nameCell}>
                <div className={styles.fileName} title={getQuotaDisplayName(file)}>
                  {getQuotaDisplayName(file)}
                </div>
                <PlanLine
                  row={row}
                  now={now}
                  canEdit={props.canRefresh}
                  onSaveRenewalDay={(day) => props.onSaveRenewalDay(row.entry, day)}
                />
              </div>
              {row.status === 'success' ? (
                <>
                  {columns.map((column) => {
                    const window = row.windows.find((w) => w.id === column.id);
                    return window ? (
                      <div key={column.id} className={styles.windowCell}>
                        <span className={styles.windowPct}>{pct(window.left)}</span>
                        <QuotaMeter percent={window.left} classes={quotaClasses} />
                        <When atMs={window.resetAtMs} now={now} />
                      </div>
                    ) : (
                      <div key={column.id} />
                    );
                  })}
                  {hasExtra && (
                    <div>
                      <ExtraCell row={row} now={now} />
                    </div>
                  )}
                </>
              ) : (
                <div style={{ gridColumn: `span ${Math.max(1, dataColumns)}` }}>
                  <RowState row={row} canRefresh={canRefresh} onRefresh={onRefresh} />
                </div>
              )}
              <RowActions
                row={row}
                canRefresh={canRefresh}
                resetting={props.resettingQuotaName === cacheKey}
                onRefresh={onRefresh}
                onReset={() => props.onReset(row.entry)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const { entries, getQuota, resolvedTheme } = props;
  const { t } = useTranslation();
  const tick = useNow(props.now === undefined);
  const now = props.now ?? tick;

  const summaries = useMemo(
    () =>
      LEDGER_PROVIDERS.map((type) => {
        const rows = entries
          .filter((entry) => entry.type === type)
          .map((entry) => buildLedgerRow(entry, getQuota(entry), t, now));
        return summarizeLedger(type, rows, now);
      }).filter((summary) => summary.rows.length > 0),
    [entries, getQuota, t, now]
  );

  if (summaries.length === 0) return null;
  return (
    <div className={styles.root}>
      <div className={styles.summaryRow}>
        {summaries.map((summary) => (
          <SummaryCard key={summary.type} summary={summary} theme={resolvedTheme} now={now} />
        ))}
      </div>
      {summaries.map((summary) => (
        <ProviderPanel key={summary.type} summary={summary} now={now} props={props} />
      ))}
    </div>
  );
}
