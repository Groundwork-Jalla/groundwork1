/** Public receipt failure codes with safe operational context, never provider bodies. */
export class ReceiptProcessingError extends Error {
  constructor(public code: string, public diagnostic: {
    reason?: string; databaseCode?: string; providerStatus?: number; providerRequestId?: string; stopReason?: string;
  } = {}) { super(code); this.name = 'ReceiptProcessingError'; }
}

export function receiptDatabaseError(error: unknown): ReceiptProcessingError {
  const value = error as { code?: string; message?: string } | null;
  const code = typeof value?.code === 'string' && /^[A-Z0-9_]{1,20}$/i.test(value.code) ? value.code : undefined;
  if (code && ['PGRST202','PGRST204','PGRST205','42703','42P01','42883'].includes(code)) {
    return new ReceiptProcessingError('receipt_reader_not_configured', { reason: 'database_migration_missing', databaseCode: code });
  }
  if (code && ['42501','PGRST301','PGRST302','PGRST303'].includes(code)) {
    return new ReceiptProcessingError('receipt_reader_not_configured', { reason: 'database_credentials_or_permissions', databaseCode: code });
  }
  return new ReceiptProcessingError('receipt_verification_unavailable', { reason: 'database_operation_failed', databaseCode: code });
}
