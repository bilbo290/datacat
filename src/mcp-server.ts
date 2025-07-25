import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import express from 'express';
import cors from 'cors';
import { createObjectCsvWriter } from 'csv-writer';
import { DatadogClient } from './datadog-client.js';
import { formatLogsAsTable, formatLogForCsv } from './formatters.js';
import type {
  MCPServerOptions,
  DatadogConfig,
  LogSearchOptions,
  LogTailOptions,
  LogExportOptions
} from './types.js';

const DATADOG_API_BASE = "https://api.datadoghq.com";
const USER_AGENT = "datacat/1.0.0";

// Zod schemas for tool arguments validation
const SearchLogsArgsSchema = z.object({
  query: z.string().describe("Datadog search query using facet syntax (e.g., 'service:vb_integration', 'status:error', 'service:api AND host:prod-01')"),
  from: z.string().describe("Start time in RFC3339 format or relative time (e.g., '1h', '1d')"),
  to: z.string().optional().describe("End time in RFC3339 format (defaults to now if not specified)"),
  limit: z.number().optional().default(1000).describe("Maximum number of logs to return (default: 1000, max: 1000)"),
  sort: z.enum(['asc', 'desc']).optional().default('desc').describe("Sort order by timestamp (default: desc)"),
  outputFormat: z.enum(['table', 'json']).optional().default('table').describe("Output format (default: table)")
});

const TailLogsArgsSchema = z.object({
  query: z.string().describe("Datadog search query using facet syntax (e.g., 'service:vb_integration', 'status:error')"),
  from: z.string().optional().describe("Start time (defaults to 1 minute ago)"),
  follow: z.boolean().optional().default(false).describe("Whether to follow logs in real-time (default: false)"),
  limit: z.number().optional().default(1000).describe("Maximum number of logs to return per request (default: 1000)")
});

const ExportLogsArgsSchema = z.object({
  query: z.string().describe("Datadog search query using facet syntax (e.g., 'service:vb_integration', 'status:error')"),
  from: z.string().describe("Start time in RFC3339 format or relative time"),
  to: z.string().describe("End time in RFC3339 format"),
  format: z.enum(['json', 'csv']).describe("Export format"),
  filename: z.string().optional().describe("Output filename (optional, will generate if not provided)"),
  limit: z.number().optional().default(1000).describe("Maximum number of logs to export (default: 1000)")
});

const GetQueryExamplesArgsSchema = z.object({
  category: z.enum(['basic', 'advanced', 'facet']).optional().describe("Type of query examples to return")
});

const GetLogsByTraceIdArgsSchema = z.object({
  traceId: z.string().describe("Trace ID to search for (e.g., '1234567890abcdef')"),
  from: z.string().optional().describe("Start time in RFC3339 format or relative time (e.g., '1h', '1d'). Defaults to last 24 hours"),
  to: z.string().optional().describe("End time in RFC3339 format (defaults to now if not specified)"),
  limit: z.number().optional().default(1000).describe("Maximum number of logs to return (default: 1000, max: 1000)"),
  sort: z.enum(['asc', 'desc']).optional().default('asc').describe("Sort order by timestamp (default: asc for trace flow)"),
  outputFormat: z.enum(['table', 'json']).optional().default('table').describe("Output format (default: table)")
});

// Create server instance
const server = new Server({
  name: "datacat-datadog-server",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

// Global Datadog client
let datadogClient: DatadogClient | null = null;

// Query normalization function to convert natural language to Datadog syntax
function normalizeQuery(query: string): string {
  // If query already contains Datadog syntax (has colons), return as-is
  if (query.includes(':') || query.includes('AND') || query.includes('OR')) {
    return query;
  }

  // Convert natural language patterns to Datadog syntax
  let normalizedQuery = query.toLowerCase();
  
  // Handle service-related queries with better wildcards
  if (normalizedQuery.includes('service') || normalizedQuery.includes('api') || normalizedQuery.includes('server')) {
    const serviceTerms = normalizedQuery
      .replace(/\b(service|api|server)\b/g, '')
      .replace(/\b(logs?|from|for|in|the|check|show|find)\b/g, '')
      .trim()
      .split(/\s+/)
      .filter(term => term.length > 0);
    
    if (serviceTerms.length > 0) {
      // Use broader wildcards for better matching
      const serviceQuery = serviceTerms.map(term => `service:*${term}*`).join(' OR ');
      const hasErrorTerms = normalizedQuery.includes('error') || normalizedQuery.includes('fail');
      
      if (hasErrorTerms) {
        return `(${serviceQuery}) AND status:error`;
      }
      return serviceQuery;
    }
  }
  
  // Handle error-related queries with wildcards
  if (normalizedQuery.includes('error') && !normalizedQuery.includes('service')) {
    return 'status:error OR *error*';
  }
  
  // Handle warning queries with wildcards  
  if (normalizedQuery.includes('warn')) {
    return 'status:warn OR *warn*';
  }
  
  // Handle authentication/auth queries
  if (normalizedQuery.includes('auth') || normalizedQuery.includes('login') || normalizedQuery.includes('token')) {
    return '*auth* OR *login* OR *token*';
  }
  
  // Handle database queries
  if (normalizedQuery.includes('database') || normalizedQuery.includes('db') || normalizedQuery.includes('sql')) {
    return '*database* OR *db* OR *sql*';
  }
  
  // Handle payment queries
  if (normalizedQuery.includes('payment') || normalizedQuery.includes('transaction')) {
    return '*payment* OR *transaction*';
  }
  
  // Handle specific terms that might be service names or general searches
  const words = normalizedQuery.split(/\s+/).filter(word => 
    word.length > 2 && 
    !['logs', 'from', 'for', 'in', 'the', 'and', 'or', 'with', 'check', 'show', 'find', 'get'].includes(word)
  );
  
  if (words.length > 0) {
    // If it's a single meaningful word, search both service and content
    if (words.length === 1) {
      return `service:*${words[0]}* OR *${words[0]}*`;
    }
    // Multiple words - create comprehensive search with wildcards
    const serviceSearch = words.map(word => `service:*${word}*`).join(' OR ');
    const contentSearch = words.map(word => `*${word}*`).join(' AND ');
    return `(${serviceSearch}) OR (${contentSearch})`;
  }
  
  // Fallback to wildcard search if no patterns match
  return `*${query}*`;
}

function getDatadogClient(): DatadogClient {
  if (!datadogClient) {
    const config: DatadogConfig = {
      apiKey: process.env.DD_API_KEY || '',
      appKey: process.env.DD_APP_KEY || '',
      region: process.env.DD_REGION || 'us1',
    };

    if (!config.apiKey || !config.appKey) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Missing required environment variables: DD_API_KEY and DD_APP_KEY must be set'
      );
    }

    datadogClient = new DatadogClient(config);
  }

  return datadogClient;
}

// Setup tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_logs',
      description: 'Search Datadog logs with filters, time ranges, and output formats. Automatically converts natural language queries to proper Datadog syntax (e.g., "member service" becomes "service:*member*").',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query - can be natural language or Datadog syntax. Examples: "member service" (searches service:*member*), "error logs" (searches status:error), "api server errors" (searches service:*api* AND status:error), or direct syntax like "service:web-app AND status:error".',
          },
          from: {
            type: 'string',
            description: 'Start time in RFC3339 format or relative time (e.g., "1h", "1d")',
          },
          to: {
            type: 'string',
            description: 'End time in RFC3339 format (defaults to now if not specified)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of logs to return (default: 1000, max: 1000)',
            default: 1000,
          },
          sort: {
            type: 'string',
            enum: ['asc', 'desc'],
            description: 'Sort order by timestamp (default: desc)',
            default: 'desc',
          },
          outputFormat: {
            type: 'string',
            enum: ['table', 'json'],
            description: 'Output format (default: table)',
            default: 'table',
          },
        },
        required: ['query', 'from'],
      },
    },
    {
      name: 'tail_logs',
      description: 'Stream recent logs or follow logs in real-time. Supports natural language queries that are automatically converted to Datadog syntax.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query - natural language or Datadog syntax. Examples: "member service", "api errors", "user authentication", or "service:vb_integration", "status:error"',
          },
          from: {
            type: 'string',
            description: 'Start time (defaults to 1 minute ago)',
          },
          follow: {
            type: 'boolean',
            description: 'Whether to follow logs in real-time (default: false)',
            default: false,
          },
          limit: {
            type: 'number',
            description: 'Maximum number of logs to return per request (default: 1000)',
            default: 1000,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'export_logs',
      description: 'Export logs to JSON or CSV files. Supports natural language queries converted to proper Datadog syntax.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query - natural language or Datadog syntax. Examples: "member service errors", "payment api logs", or direct syntax like "service:api AND status:error"',
          },
          from: {
            type: 'string',
            description: 'Start time in RFC3339 format or relative time',
          },
          to: {
            type: 'string',
            description: 'End time in RFC3339 format',
          },
          format: {
            type: 'string',
            enum: ['json', 'csv'],
            description: 'Export format',
          },
          filename: {
            type: 'string',
            description: 'Output filename (optional, will generate if not provided)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of logs to export (default: 1000)',
            default: 1000,
          },
        },
        required: ['query', 'from', 'to', 'format'],
      },
    },
    {
      name: 'get_time_range_suggestions',
      description: 'Get common time range formats for queries',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_query_examples',
      description: 'Get example Datadog search query patterns',
      inputSchema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['basic', 'advanced', 'facet'],
            description: 'Type of query examples to return',
          },
        },
      },
    },
    {
      name: 'check_configuration',
      description: 'Verify Datadog API credentials and connectivity',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_logs_by_trace_id',
      description: 'Get all logs that share the same trace ID, sorted chronologically to show the flow of a request through the system',
      inputSchema: {
        type: 'object',
        properties: {
          traceId: {
            type: 'string',
            description: 'Trace ID to search for (e.g., "1234567890abcdef")',
          },
          from: {
            type: 'string',
            description: 'Start time in RFC3339 format or relative time (e.g., "1h", "1d"). Defaults to last 24 hours',
          },
          to: {
            type: 'string',
            description: 'End time in RFC3339 format (defaults to now if not specified)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of logs to return (default: 1000, max: 1000)',
            default: 1000,
          },
          sort: {
            type: 'string',
            enum: ['asc', 'desc'],
            description: 'Sort order by timestamp (default: asc for trace flow)',
            default: 'asc',
          },
          outputFormat: {
            type: 'string',
            enum: ['table', 'json'],
            description: 'Output format (default: table)',
            default: 'table',
          },
        },
        required: ['traceId'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'search_logs': {
        const validatedArgs = SearchLogsArgsSchema.parse(args);
        const client = getDatadogClient();

        // Normalize the query for better natural language support
        const normalizedQuery = normalizeQuery(validatedArgs.query);

        // Parse time ranges properly
        let fromTime: string;
        let toTime: string;

        // Check if 'from' is a relative time range (like '1h', '1d')
        const timeRange = client.parseTimeRange(validatedArgs.from);
        if (timeRange) {
          // If 'from' is a relative range, use the parsed times
          fromTime = timeRange.from;
          // Only use the range's 'to' if user didn't specify a custom 'to'
          toTime = validatedArgs.to || timeRange.to;
        } else {
          // If 'from' is an absolute time, use it directly
          fromTime = validatedArgs.from;
          toTime = validatedArgs.to || new Date().toISOString();
        }

        const searchOptions: LogSearchOptions = {
          query: normalizedQuery,
          from: fromTime,
          to: toTime,
          limit: validatedArgs.limit,
          sort: validatedArgs.sort,
          outputFormat: validatedArgs.outputFormat
        };

        const response = await client.searchLogs(searchOptions);

        // Show query translation if it was normalized
        const queryInfo = normalizedQuery !== validatedArgs.query 
          ? `Query: "${validatedArgs.query}" → "${normalizedQuery}"\n`
          : '';
        
        // Show time range information
        const timeInfo = `Time range: ${fromTime} to ${toTime}\n${queryInfo ? '\n' : ''}`;

        if (validatedArgs.outputFormat === 'json') {
          return {
            content: [
              {
                type: "text",
                text: `${queryInfo}${timeInfo}${JSON.stringify(response.data, null, 2)}`,
              },
            ],
          };
        } else {
          const tableOutput = formatLogsAsTable(response.data);
          return {
            content: [
              {
                type: "text",
                text: `${queryInfo}${timeInfo}${tableOutput}`,
              },
            ],
          };
        }
      }

      case 'tail_logs': {
        const validatedArgs = TailLogsArgsSchema.parse(args);
        const client = getDatadogClient();
        const normalizedQuery = normalizeQuery(validatedArgs.query);
        const response = await client.tailLogs({
          query: normalizedQuery,
          from: validatedArgs.from,
          follow: validatedArgs.follow,
          limit: validatedArgs.limit
        });

        const tableOutput = formatLogsAsTable(response.data);
        const queryInfo = normalizedQuery !== validatedArgs.query 
          ? `Query: "${validatedArgs.query}" → "${normalizedQuery}"\n`
          : '';
        
        // Show time range for tail logs
        const fromTime = validatedArgs.from || new Date(Date.now() - 60000).toISOString();
        const toTime = new Date().toISOString();
        const timeInfo = `Time range: ${fromTime} to ${toTime}\n${queryInfo ? '\n' : ''}`;

        if (validatedArgs.follow) {
          return {
            content: [
              {
                type: "text",
                text: `${queryInfo}${timeInfo}Following logs (showing latest ${response.data.length} entries):\n\n${tableOutput}\n\nNote: Real-time following requires streaming implementation.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `${queryInfo}${timeInfo}${tableOutput}`,
            },
          ],
        };
      }

      case 'export_logs': {
        const validatedArgs = ExportLogsArgsSchema.parse(args);
        const client = getDatadogClient();
        const normalizedQuery = normalizeQuery(validatedArgs.query);

        // Parse time ranges properly
        let fromTime: string;
        let toTime: string;

        // Check if 'from' is a relative time range (like '1h', '1d')
        const timeRange = client.parseTimeRange(validatedArgs.from);
        if (timeRange) {
          // If 'from' is a relative range, use the parsed times
          fromTime = timeRange.from;
          // For export, user must provide 'to' parameter, but if they provided relative from, use range
          toTime = validatedArgs.to;
        } else {
          // If 'from' is an absolute time, use both directly
          fromTime = validatedArgs.from;
          toTime = validatedArgs.to;
        }

        const searchOptions: LogSearchOptions = {
          query: normalizedQuery,
          from: fromTime,
          to: toTime,
          limit: validatedArgs.limit,
        };

        const response = await client.searchLogs(searchOptions);

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputFilename = validatedArgs.filename || `datadog-logs-${timestamp}.${validatedArgs.format}`;

        if (validatedArgs.format === 'json') {
          const fs = await import('fs/promises');
          await fs.writeFile(outputFilename, JSON.stringify(response.data, null, 2));
        } else if (validatedArgs.format === 'csv') {
          const csvData = response.data.map(formatLogForCsv);
          const csvWriter = createObjectCsvWriter({
            path: outputFilename,
            header: [
              { id: 'timestamp', title: 'Timestamp' },
              { id: 'message', title: 'Message' },
              { id: 'status', title: 'Status' },
              { id: 'service', title: 'Service' },
              { id: 'host', title: 'Host' },
              { id: 'tags', title: 'Tags' },
            ],
          });
          await csvWriter.writeRecords(csvData);
        }

        const queryInfo = normalizedQuery !== validatedArgs.query 
          ? `Query: "${validatedArgs.query}" → "${normalizedQuery}"\n`
          : '';
        
        const timeInfo = `Time range: ${fromTime} to ${toTime}\n${queryInfo ? '\n' : ''}`;

        return {
          content: [
            {
              type: "text",
              text: `${queryInfo}${timeInfo}Exported ${response.data.length} logs to ${outputFilename}`,
            },
          ],
        };
      }

      case 'get_time_range_suggestions': {
        const suggestions = {
          relative: [
            { value: '1h', description: 'Last 1 hour' },
            { value: '4h', description: 'Last 4 hours' },
            { value: '1d', description: 'Last 1 day' },
            { value: '3d', description: 'Last 3 days' },
            { value: '7d', description: 'Last 7 days' },
            { value: '30d', description: 'Last 30 days' },
          ],
          absolute: [
            {
              format: 'RFC3339',
              example: '2024-01-15T10:00:00Z',
              description: 'ISO 8601 format with timezone',
            },
            {
              format: 'Unix timestamp',
              example: '1642248000',
              description: 'Unix timestamp in seconds',
            },
          ],
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(suggestions, null, 2),
            },
          ],
        };
      }

      case 'get_query_examples': {
        const validatedArgs = GetQueryExamplesArgsSchema.parse(args || {});
        const allExamples = {
          basic: [
            { query: 'service:vb_integration', description: 'Find logs from vb_integration service' },
            { query: 'status:error', description: 'Find error logs' },
            { query: 'host:prod-server-01', description: 'Find logs from specific host' },
            { query: 'ERROR', description: 'Find logs containing "ERROR" text' },
          ],
          advanced: [
            {
              query: 'service:vb_integration AND status:error',
              description: 'Find errors from vb_integration service',
            },
            {
              query: 'service:(vb_integration OR api-server)',
              description: 'Find logs from multiple services',
            },
            {
              query: 'service:vb_integration -status:info',
              description: 'Find vb_integration logs excluding info level',
            },
            {
              query: '@duration:>1000',
              description: 'Find logs with custom attribute duration > 1000ms',
            },
          ],
          facet: [
            {
              query: '@http.status_code:500',
              description: 'Filter by HTTP status code facet',
            },
            {
              query: '@user.id:"123456"',
              description: 'Filter by user ID facet',
            },
            {
              query: '@trace_id:*',
              description: 'Logs that have a trace ID',
            },
            {
              query: '@trace_id:1234567890abcdef',
              description: 'Get all logs for a specific trace ID (use get_logs_by_trace_id tool for better formatting)',
            },
            {
              query: '@error.kind:"TimeoutException"',
              description: 'Filter by error type facet',
            },
          ],
        };

        const examples = validatedArgs.category ? allExamples[validatedArgs.category] : allExamples;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(examples, null, 2),
            },
          ],
        };
      }

      case 'check_configuration': {
        try {
          const client = getDatadogClient();
          const status = await client.checkConnection();

          const config = {
            apiKey: process.env.DD_API_KEY ? '***configured***' : 'NOT SET',
            appKey: process.env.DD_APP_KEY ? '***configured***' : 'NOT SET',
            region: process.env.DD_REGION || 'us1 (default)',
          };

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  configuration: config,
                  connectivity: status,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  configuration: {
                    apiKey: process.env.DD_API_KEY ? '***configured***' : 'NOT SET',
                    appKey: process.env.DD_APP_KEY ? '***configured***' : 'NOT SET',
                    region: process.env.DD_REGION || 'us1 (default)',
                  },
                  connectivity: {
                    status: 'error',
                    message: errorMessage,
                  },
                }, null, 2),
              },
            ],
          };
        }
      }

      case 'get_logs_by_trace_id': {
        const validatedArgs = GetLogsByTraceIdArgsSchema.parse(args);
        const client = getDatadogClient();

        // Build the trace ID query using Datadog's facet syntax
        const query = `@trace_id:${validatedArgs.traceId}`;

        // Handle time range - default to last 24 hours if not specified
        let fromTime: string;
        let toTime: string;

        if (validatedArgs.from) {
          // Parse time ranges properly
          const timeRange = client.parseTimeRange(validatedArgs.from);
          if (timeRange) {
            fromTime = timeRange.from;
            toTime = validatedArgs.to || timeRange.to;
          } else {
            fromTime = validatedArgs.from;
            toTime = validatedArgs.to || new Date().toISOString();
          }
        } else {
          // Default to last 24 hours
          const now = new Date();
          const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          fromTime = dayAgo.toISOString();
          toTime = validatedArgs.to || now.toISOString();
        }

        const searchOptions: LogSearchOptions = {
          query: query,
          from: fromTime,
          to: toTime,
          limit: validatedArgs.limit,
          sort: validatedArgs.sort,
          outputFormat: validatedArgs.outputFormat
        };

        const response = await client.searchLogs(searchOptions);

        // Show trace ID and time range information
        const traceInfo = `Trace ID: ${validatedArgs.traceId}\n`;
        const timeInfo = `Time range: ${fromTime} to ${toTime}\n`;
        const countInfo = `Found ${response.data.length} log entries for this trace\n\n`;

        if (validatedArgs.outputFormat === 'json') {
          return {
            content: [
              {
                type: "text",
                text: `${traceInfo}${timeInfo}${countInfo}${JSON.stringify(response.data, null, 2)}`,
              },
            ],
          };
        } else {
          const tableOutput = formatLogsAsTable(response.data);
          return {
            content: [
              {
                type: "text",
                text: `${traceInfo}${timeInfo}${countInfo}${tableOutput}`,
              },
            ],
          };
        }
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    // Return user-friendly error instead of throwing scary exceptions
    return {
      content: [
        {
          type: "text",
          text: `❌ Error: ${errorMessage}\n\nTip: Check your Datadog credentials and query syntax. Use 'check_configuration' to verify your setup.`,
        },
      ],
    };
  }
});

// Error handling
server.onerror = (error) => {
  process.stderr.write(`MCP Server Error: ${error}\n`);
};

// Export start function
export async function startMCPServer(options: MCPServerOptions): Promise<void> {
  if (options.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('Datadog MCP server running on stdio transport\n');
  } else if (options.transport === 'sse') {
    // For SSE, we'll implement a basic HTTP server
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Add health check endpoint
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'datacat-datadog-server' });
    });

    // Basic SSE endpoint
    app.get('/datadog/sse', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      res.write('event: message\n');
      res.write('data: {"jsonrpc":"2.0","method":"notifications/initialized"}\n\n');

      const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n');
      }, 30000);

      req.on('close', () => {
        clearInterval(keepAlive);
      });
    });

    const port = options.port ? parseInt(options.port, 10) : 9005;

    return new Promise<void>((resolve) => {
      app.listen(port, () => {
        process.stderr.write(`Datadog MCP server running on http://localhost:${port}/datadog\n`);
        process.stderr.write(`Health check available at http://localhost:${port}/health\n`);
        process.stderr.write(`Note: For full MCP support, use stdio transport\n`);
        resolve();
      });
    });
  }
}