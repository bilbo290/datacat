import type { DatadogLogEvent } from './types.js';

export function formatLogsAsTable(logs: DatadogLogEvent[]): string {
  if (logs.length === 0) {
    return 'No logs found.';
  }

  const headers = ['Timestamp', 'Status', 'Service', 'Host', 'Message'];
  const rows = logs.map(log => [
    log.attributes.timestamp,
    log.attributes.status || 'N/A',
    log.attributes.service || 'N/A', 
    log.attributes.host || 'N/A',
    truncateMessage(log.attributes.message || '', 100)
  ]);

  return formatTable(headers, rows);
}

export function formatLogForCsv(log: DatadogLogEvent) {
  return {
    timestamp: log.attributes.timestamp,
    message: log.attributes.message || '',
    status: log.attributes.status || '',
    service: log.attributes.service || '',
    host: log.attributes.host || '',
    tags: log.attributes.tags ? log.attributes.tags.join(', ') : '',
  };
}

function truncateMessage(message: string, maxLength: number): string {
  if (message.length <= maxLength) {
    return message;
  }
  return message.substring(0, maxLength - 3) + '...';
}

function formatTable(headers: string[], rows: string[][]): string {
  const columnWidths = headers.map((header, index) => {
    const maxRowWidth = Math.max(...rows.map(row => (row[index] || '').length));
    return Math.max(header.length, maxRowWidth);
  });

  const separator = '─'.repeat(columnWidths.reduce((sum, width) => sum + width + 3, -1));
  
  const headerRow = headers
    .map((header, index) => header.padEnd(columnWidths[index]))
    .join(' │ ');

  const dataRows = rows.map(row =>
    row.map((cell, index) => (cell || '').padEnd(columnWidths[index]))
      .join(' │ ')
  );

  return [
    headerRow,
    separator,
    ...dataRows
  ].join('\n');
}