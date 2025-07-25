import type { DatadogLogEvent } from './types.js';

export function formatLogsAsTable(logs: DatadogLogEvent[]): string {
  if (logs.length === 0) {
    return 'No logs found.';
  }

  // Extract key attributes that are commonly useful
  const headers = ['Timestamp', 'Status', 'Service', 'Host', 'Trace ID', 'User ID', 'HTTP Status', 'Message'];
  const rows = logs.map(log => {
    const attrs = log.attributes;
    return [
      attrs.timestamp,
      attrs.status || 'N/A',
      attrs.service || 'N/A', 
      attrs.host || 'N/A',
      getAttributeValue(attrs, 'trace_id') || 'N/A',
      getAttributeValue(attrs, 'user.id') || 'N/A',
      getAttributeValue(attrs, 'http.status_code') || 'N/A',
      truncateMessage(attrs.message || '', 80) // Reduced from 100 to fit more columns
    ];
  });

  return formatTable(headers, rows);
}

// Helper function to get attribute values with @ prefix support
function getAttributeValue(attributes: any, key: string): string | undefined {
  // Try both with and without @ prefix
  return attributes[`@${key}`] || attributes[key];
}

// Enhanced table formatter that can show additional attributes when present
export function formatLogsAsEnhancedTable(logs: DatadogLogEvent[]): string {
  if (logs.length === 0) {
    return 'No logs found.';
  }

  // Find all unique attribute keys across all logs
  const allKeys = new Set<string>();
  logs.forEach(log => {
    Object.keys(log.attributes).forEach(key => allKeys.add(key));
  });

  // Define important attributes to always show (in order)
  const priorityAttributes = [
    'timestamp', 'status', 'service', 'host', 
    'trace_id', '@trace_id',
    'user.id', '@user.id', 
    'http.status_code', '@http.status_code',
    'error.kind', '@error.kind',
    'span_id', '@span_id',
    'request_id', '@request_id'
  ];

  // Find which priority attributes are present
  const presentPriorityAttrs = priorityAttributes.filter(attr => 
    logs.some(log => log.attributes[attr] !== undefined)
  );

  // Build headers - always include basic ones, then add present priority attributes, then message
  const basicHeaders = ['Timestamp', 'Status', 'Service', 'Host'];
  const dynamicHeaders: string[] = [];
  
  presentPriorityAttrs.forEach(attr => {
    if (!['timestamp', 'status', 'service', 'host'].includes(attr)) {
      // Format header name nicely
      let headerName = attr.replace('@', '').replace('.', ' ').replace('_', ' ');
      headerName = headerName.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
      
      if (!dynamicHeaders.includes(headerName)) {
        dynamicHeaders.push(headerName);
      }
    }
  });

  const headers = [...basicHeaders, ...dynamicHeaders, 'Message'];
  
  const rows = logs.map(log => {
    const attrs = log.attributes;
    const row = [
      attrs.timestamp,
      attrs.status || 'N/A',
      attrs.service || 'N/A', 
      attrs.host || 'N/A'
    ];

    // Add dynamic attribute values in the same order as headers
    presentPriorityAttrs.forEach(attr => {
      if (!['timestamp', 'status', 'service', 'host'].includes(attr)) {
        const value = attrs[attr];
        row.push(value?.toString() || 'N/A');
      }
    });

    // Add message last, truncated to fit
    row.push(truncateMessage(attrs.message || '', 60));
    
    return row;
  });

  return formatTable(headers, rows);
}

export function formatLogForCsv(log: DatadogLogEvent) {
  const attrs = log.attributes;
  return {
    timestamp: attrs.timestamp,
    message: attrs.message || '',
    status: attrs.status || '',
    service: attrs.service || '',
    host: attrs.host || '',
    trace_id: getAttributeValue(attrs, 'trace_id') || '',
    user_id: getAttributeValue(attrs, 'user.id') || '',
    http_status_code: getAttributeValue(attrs, 'http.status_code') || '',
    tags: attrs.tags ? attrs.tags.join(', ') : '',
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