export interface DatadogConfig {
  apiKey: string;
  appKey: string;
  region?: string;
}

export interface LogSearchOptions {
  query: string;
  from: string;
  to: string;
  limit?: number;
  sort?: 'asc' | 'desc';
  outputFormat?: 'table' | 'json';
}

export interface LogTailOptions {
  query: string;
  from?: string;
  follow?: boolean;
  limit?: number;
}

export interface LogExportOptions {
  query: string;
  from: string;
  to: string;
  format: 'json' | 'csv';
  filename?: string;
  limit?: number;
}

export interface DatadogLogEvent {
  id: string;
  attributes: {
    timestamp: string;
    message: string;
    status: string;
    service?: string;
    host?: string;
    tags?: string[];
    [key: string]: any;
  };
}

export interface DatadogLogSearchResponse {
  data: DatadogLogEvent[];
  meta: {
    page: {
      after?: string;
    };
    status: string;
    request_id: string;
  };
}

export interface MCPServerOptions {
  transport: 'stdio' | 'sse';
  port?: string;
}

export interface ConnectionStatus {
  status: 'connected' | 'error';
  message: string;
}