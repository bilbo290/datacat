import fetch from 'node-fetch';
import type { 
  DatadogConfig, 
  LogSearchOptions, 
  LogTailOptions,
  DatadogLogSearchResponse,
  ConnectionStatus 
} from './types.js';

export class DatadogClient {
  private apiKey: string;
  private appKey: string;
  private region: string;
  private baseUrl: string;

  constructor(config: DatadogConfig) {
    this.apiKey = config.apiKey;
    this.appKey = config.appKey;
    this.region = config.region || 'us1';
    this.baseUrl = this.getBaseUrl(this.region);
  }

  private getBaseUrl(region: string): string {
    const regionMap: Record<string, string> = {
      'us1': 'https://api.datadoghq.com',
      'us3': 'https://api.us3.datadoghq.com',
      'us5': 'https://api.us5.datadoghq.com',
      'eu1': 'https://api.datadoghq.eu',
      'ap1': 'https://api.ap1.datadoghq.com',
      'gov': 'https://api.ddog-gov.com'
    };
    return regionMap[region] || regionMap.us1;
  }

  private getHeaders(): Record<string, string> {
    return {
      'DD-API-KEY': this.apiKey,
      'DD-APPLICATION-KEY': this.appKey,
      'Content-Type': 'application/json'
    };
  }

  private async makeRequest(endpoint: string, options: any = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      let friendlyMessage = '';
      
      if (response.status === 401) {
        friendlyMessage = 'Invalid API credentials. Please check your DD_API_KEY and DD_APP_KEY.';
      } else if (response.status === 403) {
        friendlyMessage = 'Access denied. Please verify your Datadog permissions and API key scopes.';
      } else if (response.status === 429) {
        friendlyMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
      } else if (response.status >= 500) {
        friendlyMessage = 'Datadog service temporarily unavailable. Please try again later.';
      } else {
        friendlyMessage = `Request failed with status ${response.status}. ${errorText}`;
      }
      
      throw new Error(friendlyMessage);
    }

    return response.json();
  }

  async searchLogs(options: LogSearchOptions): Promise<DatadogLogSearchResponse> {
    const { query, from, to, limit = 1000, sort = 'desc' } = options;
    
    const body = {
      filter: {
        from,
        to,
        query: query || '*'
      },
      sort: sort === 'asc' ? 'timestamp' : '-timestamp',
      page: {
        limit: Math.min(limit, 1000)
      }
    };

    return this.makeRequest('/api/v2/logs/events/search', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async tailLogs(options: LogTailOptions): Promise<DatadogLogSearchResponse> {
    const { query, from, limit = 1000 } = options;
    
    const fromTime = from || new Date(Date.now() - 60000).toISOString(); // Default to 1 minute ago
    const toTime = new Date().toISOString();
    
    const body = {
      filter: {
        from: fromTime,
        to: toTime,
        query: query || '*'
      },
      sort: '-timestamp',
      page: {
        limit: Math.min(limit, 1000)
      }
    };

    return this.makeRequest('/api/v2/logs/events/search', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async checkConnection(): Promise<ConnectionStatus> {
    try {
      // Use a simple API endpoint to test connectivity
      // We'll try to get a minimal log search to validate credentials
      const testBody = {
        filter: {
          from: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
          to: new Date().toISOString(),
          query: '*'
        },
        page: {
          limit: 1
        }
      };
      
      await this.makeRequest('/api/v2/logs/events/search', {
        method: 'POST',
        body: JSON.stringify(testBody)
      });
      
      return { status: 'connected', message: 'Successfully connected to Datadog API' };
    } catch (error) {
      return { 
        status: 'error', 
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  formatTimestamp(timestamp: string | Date | number): string {
    if (typeof timestamp === 'string') {
      return timestamp;
    }
    if (timestamp instanceof Date) {
      return timestamp.toISOString();
    }
    if (typeof timestamp === 'number') {
      return new Date(timestamp).toISOString();
    }
    return new Date().toISOString();
  }

  parseTimeRange(timeRange: string): { from: string; to: string } | null {
    const now = new Date();
    const ranges: Record<string, Date> = {
      '1h': new Date(now.getTime() - 60 * 60 * 1000),
      '2h': new Date(now.getTime() - 2 * 60 * 60 * 1000),
      '4h': new Date(now.getTime() - 4 * 60 * 60 * 1000),
      '6h': new Date(now.getTime() - 6 * 60 * 60 * 1000),
      '12h': new Date(now.getTime() - 12 * 60 * 60 * 1000),
      '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
      '1d': new Date(now.getTime() - 24 * 60 * 60 * 1000),
      '2d': new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      '3d': new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      '7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      '14d': new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
      '30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    };

    if (ranges[timeRange]) {
      return {
        from: this.formatTimestamp(ranges[timeRange]),
        to: this.formatTimestamp(now)
      };
    }

    return null;
  }
}