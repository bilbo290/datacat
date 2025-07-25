# Datacat - Datadog MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)

A server that provides AI assistants with tools to interact with Datadog logs through the Model Context Protocol (MCP). Built specifically for Claude Desktop and Claude Code integration.

## Features

- **search_logs** - Search Datadog logs with filters, time ranges, and output formats. Shows trace IDs, user IDs, HTTP status codes and other key attributes when available
- **tail_logs** - Stream recent logs or follow logs in real-time with enhanced attribute display
- **export_logs** - Export logs to JSON/CSV files with comprehensive attribute coverage
- **get_logs_by_trace_id** - Get all logs that share the same trace ID, sorted chronologically with full context
- **get_time_range_suggestions** - Get common time range formats for queries
- **get_query_examples** - Get example Datadog search query patterns
- **check_configuration** - Verify Datadog API credentials and connectivity

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Datadog account with API access
- Claude Desktop or Claude Code

### 1. Installation

#### Option A: From Source (Recommended)
```bash
git clone https://github.com/yourusername/datacat.git
cd datacat
npm install
npm run build
```

#### Option B: Global Installation
```bash
# After cloning and building
npm install -g .
```

### 2. Get Datadog Credentials

1. Log into your Datadog account
2. Go to **Organization Settings** → **API Keys**
3. Create or copy your **API Key**
4. Go to **Organization Settings** → **Application Keys** 
5. Create or copy your **Application Key**

### 3. Configure Claude Integration

#### For Claude Desktop

1. Open Claude Desktop configuration file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. Add the datacat server configuration:
```json
{
  "mcpServers": {
    "datacat": {
      "command": "node",
      "args": ["/full/path/to/datacat/dist/index.js", "mcp"],
      "env": {
        "DD_API_KEY": "your_datadog_api_key_here",
        "DD_APP_KEY": "your_datadog_app_key_here",
        "DD_REGION": "us1"
      }
    }
  }
}
```

3. **Replace the path**: Change `/full/path/to/datacat/dist/index.js` to your actual installation path
4. **Replace credentials**: Add your actual Datadog API and App keys
5. **Set region**: Change `us1` to your Datadog region if different
6. **Restart Claude Desktop**

#### For Claude Code

Add to your Claude Code MCP configuration:
```json
{
  "mcpServers": {
    "datacat": {
      "command": "node", 
      "args": ["/full/path/to/datacat/dist/index.js", "mcp"],
      "env": {
        "DD_API_KEY": "your_datadog_api_key_here",
        "DD_APP_KEY": "your_datadog_app_key_here",
        "DD_REGION": "us1"
      }
    }
  }
}
```

### 4. Test the Integration

1. Open Claude Desktop or Claude Code
2. Start a new conversation
3. Try these test commands:

**Check connection:**
```
Check my Datadog configuration and connectivity
```

**Search logs:**
```
Search for logs from service:my-service in the last 1 hour
```

**Get help:**
```
Show me examples of Datadog log queries I can use
```

## Advanced Configuration

### Environment Variables

You can set these environment variables instead of putting credentials in the MCP configuration:

```bash
export DD_API_KEY="your_datadog_api_key"
export DD_APP_KEY="your_datadog_app_key"
export DD_REGION="us1"  # Optional, defaults to us1
```

### Supported Datadog Regions

| Region | URL | Description |
|--------|-----|-------------|
| `us1` | https://api.datadoghq.com | US (default) |
| `us3` | https://api.us3.datadoghq.com | US East |
| `us5` | https://api.us5.datadoghq.com | US West |
| `eu1` | https://api.datadoghq.eu | Europe |
| `ap1` | https://api.ap1.datadoghq.com | Asia Pacific |
| `gov` | https://api.ddog-gov.com | US Government |

### Global Installation Configuration

If you installed globally with `npm install -g .`, you can use:

```json
{
  "mcpServers": {
    "datacat": {
      "command": "datacat",
      "args": ["mcp"],
      "env": {
        "DD_API_KEY": "your_datadog_api_key_here",
        "DD_APP_KEY": "your_datadog_app_key_here",
        "DD_REGION": "us1"
      }
    }
  }
}
```

## Usage Examples

### Basic Usage

Once configured with Claude, you can use natural language to interact with your Datadog logs:

**Search for service logs:**
```
"Show me logs from the vb_integration service in the last 2 hours"
```

**Find errors:**
```
"Search for error logs from service:api-server in the last day"
```

**Export logs:**
```
"Export all logs from service:web-app with status:error from the last 4 hours to a CSV file"
```

**Get help:**
```
"Show me examples of Datadog query syntax I can use"
```

**Track a request by trace ID:**
```
"Show me all logs for trace ID abc123def456 from the last 2 hours"
```

### Available Tools

When properly configured, Claude will have access to these tools:

| Tool | Description | Example Usage |
|------|-------------|---------------|
| `search_logs` | Search and filter logs | "Find logs from service:api" |
| `tail_logs` | Stream recent logs | "Show recent logs from my service" |
| `export_logs` | Export to JSON/CSV | "Export error logs to CSV" |
| `get_logs_by_trace_id` | Get all logs for a trace | "Show me all logs for trace abc123" |
| `get_time_range_suggestions` | Get time formats | "What time ranges can I use?" |
| `get_query_examples` | Get query examples | "Show me query examples" |
| `check_configuration` | Verify connection | "Check my Datadog connection" |

### Manual CLI Usage

You can also run the server manually for testing:

```bash
# Start MCP server (stdio transport)
npm run mcp

# Start with custom port (not recommended for Claude)
node dist/index.js mcp --transport sse --port 8080

# Show CLI help
datacat --help
```

## MCP Tools

### search_logs

Search Datadog logs with various filters and options.

**Parameters:**
- `query` (required) - Datadog search query (e.g., "service:web-app ERROR", "status:error")
- `from` (required) - Start time in RFC3339 format or relative time (e.g., "1h", "1d")
- `to` (optional) - End time in RFC3339 format (defaults to now)
- `limit` (optional) - Maximum number of logs to return (default: 1000, max: 1000)
- `sort` (optional) - Sort order by timestamp: "asc" or "desc" (default: "desc")
- `outputFormat` (optional) - Output format: "table" or "json" (default: "table")

### tail_logs

Stream recent logs or follow logs in real-time.

**Parameters:**
- `query` (required) - Datadog search query
- `from` (optional) - Start time (defaults to 1 minute ago)
- `follow` (optional) - Whether to follow logs in real-time (default: false)
- `limit` (optional) - Maximum number of logs to return per request (default: 1000)

### export_logs

Export logs to JSON or CSV files.

**Parameters:**
- `query` (required) - Datadog search query
- `from` (required) - Start time in RFC3339 format or relative time
- `to` (required) - End time in RFC3339 format
- `format` (required) - Export format: "json" or "csv"
- `filename` (optional) - Output filename (will generate if not provided)
- `limit` (optional) - Maximum number of logs to export (default: 1000)

### get_time_range_suggestions

Get common time range formats for queries. No parameters required.

### get_query_examples

Get example Datadog search query patterns.

**Parameters:**
- `category` (optional) - Type of query examples: "basic", "advanced", or "facet"

### get_logs_by_trace_id

Get all logs that share the same trace ID, sorted chronologically to show the flow of a request through the system.

**Parameters:**
- `traceId` (required) - Trace ID to search for (e.g., "1234567890abcdef")
- `from` (optional) - Start time in RFC3339 format or relative time (e.g., "1h", "1d"). Defaults to last 24 hours
- `to` (optional) - End time in RFC3339 format (defaults to now if not specified)
- `limit` (optional) - Maximum number of logs to return (default: 1000, max: 1000)
- `sort` (optional) - Sort order by timestamp: "asc" or "desc" (default: "asc" for trace flow)
- `outputFormat` (optional) - Output format: "table" or "json" (default: "table")

### check_configuration

Verify Datadog API credentials and connectivity. No parameters required.

## Query Examples

**Important**: Use Datadog facet syntax for queries. For service logs, use `service:service_name` format.

### Basic Queries
- `service:vb_integration` - Find logs from vb_integration service
- `status:error` - Find error logs  
- `host:prod-server-01` - Filter by hostname
- `ERROR` - Find logs containing "ERROR" text

### Advanced Queries
- `service:vb_integration AND status:error` - Find errors from vb_integration service
- `service:(vb_integration OR api-server)` - Find logs from multiple services
- `service:vb_integration -status:info` - Find vb_integration logs excluding info level
- `@duration:>1000` - Numeric comparison on custom attribute

### Facet Queries
- `@http.status_code:500` - Filter by HTTP status code facet
- `@user.id:"123456"` - Filter by user ID facet
- `@trace_id:*` - Logs that have a trace ID
- `@error.kind:"TimeoutException"` - Filter by error type facet

## Time Range Examples

### Relative Time Ranges
- `1h` - Last 1 hour
- `2h` - Last 2 hours
- `4h` - Last 4 hours
- `6h` - Last 6 hours
- `12h` - Last 12 hours
- `24h` - Last 24 hours
- `1d` - Last 1 day (same as 24h)
- `2d` - Last 2 days
- `3d` - Last 3 days
- `7d` - Last 7 days
- `14d` - Last 14 days
- `30d` - Last 30 days

### Absolute Time Ranges
- `2024-01-15T10:00:00Z` - RFC3339 format with timezone
- `1642248000` - Unix timestamp in seconds

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Development mode with watch
npm run dev

# Clean build artifacts
npm run clean
```

## Architecture

- Built with TypeScript and compiled to ES modules
- Uses MCP SDK for protocol implementation
- Supports stdio transport for MCP communication
- Datadog API integration with proper error handling
- Configurable output formats (table, JSON, CSV)

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests if applicable
4. Build and test: `npm run build`
5. Commit your changes: `git commit -am 'Add feature'`
6. Push to the branch: `git push origin feature-name`
7. Submit a pull request

## Development

### Project Structure

```
datacat/
├── src/
│   ├── datadog-client.ts    # Datadog API client
│   ├── mcp-server.ts        # MCP server implementation
│   ├── formatters.ts        # Log output formatters
│   └── types.ts             # TypeScript type definitions
├── index.ts                 # CLI entry point
├── package.json
├── tsconfig.json
└── README.md
```

### Available Scripts

- `npm run build` - Build TypeScript to JavaScript
- `npm run clean` - Remove build artifacts
- `npm run dev` - Development mode with file watching
- `npm start` - Build and start the server
- `npm run mcp` - Build and start MCP server

### Debugging

To enable debug logging during development, you can modify the `makeRequest` method in `src/datadog-client.ts` to add console logging.

## License

MIT License - see the [LICENSE](LICENSE) file for details.