import { describe, expect, it } from 'vitest';
import { escapeCsvCell, formatAuditLogCsv } from './audit-csv';
import type { UnifiedAuditRow } from '@/lib/supabase/activity';
import type { TKey } from '@/lib/i18n';

const mockT = (key: TKey): string => {
  const map: Record<string, string> = {
    'admin.auditLog.colTime': 'Timestamp',
    'admin.auditLog.colCategory': 'Category',
    'admin.auditLog.colEvent': 'Event',
    'admin.auditLog.source': 'Source table',
    'admin.auditLog.colActor': 'Actor',
    'admin.auditLog.colTarget': 'Target',
    'admin.auditLog.recordedDiff': 'Recorded details',
    'admin.auditLog.unknownActor': 'Unknown account',
    'admin.ops.action.substage_added': 'added a substage',
    'admin.ops.action.other': 'updated the project',
  };
  return map[key] ?? key;
};

describe('audit log CSV export', () => {
  it('escapes quotes, commas, newlines, and neutralizes formula injection', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('a, "b"\nc')).toBe('"a, ""b""\nc"');
    expect(escapeCsvCell('=CMD()')).toBe("'=CMD()");
    expect(escapeCsvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(escapeCsvCell('-1+1')).toBe("'-1+1");
    expect(escapeCsvCell('@evil')).toBe("'@evil");
  });

  it('produces UTF-8 BOM CSV with headers and human-readable event labels', () => {
    const rows: UnifiedAuditRow[] = [
      {
        id: 'pal:1',
        source: 'project_audit_log',
        category: 'project',
        action: 'substage.added',
        actorId: 'u1',
        actorName: 'Vanessa',
        actorRoles: 'contractor',
        personName: '',
        projectId: 'p1',
        projectName: 'Villa Bonapriso',
        details: { stage_number: 5, name: 'Perimeter wall' },
        createdAt: '2026-11-23T12:00:00Z',
      },
    ];
    const csv = formatAuditLogCsv(rows, mockT);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Timestamp,Category,Event,Action key,Source table,Actor,Actor roles,Target,Recorded details');
    expect(lines[1]).toContain('2026-11-23T12:00:00Z,project,added a substage,substage.added,project_audit_log,Vanessa,contractor,Villa Bonapriso');
    expect(lines[1]).toContain('Perimeter wall');
  });
});
