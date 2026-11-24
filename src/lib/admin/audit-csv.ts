import type { UnifiedAuditRow } from '@/lib/supabase/activity';
import { actionLabel } from '@/lib/admin/action-labels';
import type { TKey } from '@/lib/i18n';

/**
 * Neutralize spreadsheet formula triggers (=, +, -, @, tab, CR) and apply RFC-4180
 * quoting so exported audit logs open safely in Excel and Google Sheets.
 */
export function escapeCsvCell(value: unknown): string {
  let str = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function formatAuditLogCsv(
  rows: UnifiedAuditRow[],
  t: (key: TKey) => string,
): string {
  const headers = [
    t('admin.auditLog.colTime'),
    t('admin.auditLog.colCategory'),
    t('admin.auditLog.colEvent'),
    'Action key',
    t('admin.auditLog.source'),
    t('admin.auditLog.colActor'),
    'Actor roles',
    t('admin.auditLog.colTarget'),
    t('admin.auditLog.recordedDiff'),
  ];

  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.createdAt,
        r.category,
        actionLabel(r.action, t),
        r.action,
        r.source,
        r.actorName || t('admin.auditLog.unknownActor'),
        r.actorRoles,
        r.projectName || r.personName || '',
        JSON.stringify(r.details ?? {}),
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }
  // UTF-8 BOM ensures accented French characters open cleanly in Microsoft Excel.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function downloadAuditLogCsv(
  csv: string,
  category: string,
  range?: { from?: string; to?: string },
): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const date = new Date().toISOString().slice(0, 10);
  const suffix = category && category !== 'all' ? `-${category}` : '';
  const rangePart = range?.from && range?.to
    ? `-${range.from}-to-${range.to}`
    : range?.from
      ? `-from-${range.from}`
      : range?.to
        ? `-until-${range.to}`
        : `-${date}`;
  const filename = `groundwork-audit-log${suffix}${rangePart}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
