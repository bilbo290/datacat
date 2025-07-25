#!/usr/bin/env node

import { program } from 'commander';
import { startMCPServer } from './src/mcp-server.js';

program
  .name('datacat')
  .description('AI assistant tools for interacting with Datadog logs')
  .version('1.0.0');

program
  .command('mcp')
  .description('Start MCP server for Datadog logs')
  .option('--transport <type>', 'Transport type (stdio|sse)', 'stdio')
  .option('--port <port>', 'Port for SSE transport', '9005')
  .action(async (options) => {
    try {
      await startMCPServer(options);
    } catch (error) {
      process.stderr.write(`Failed to start MCP server: ${error}\n`);
      process.exit(1);
    }
  });

program.parse();