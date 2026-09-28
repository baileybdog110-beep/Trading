#!/usr/bin/env node
/**
 * MCP server over stdio - for local AI clients (Claude Desktop / Claude Code, Meta Muse Code,
 * and other MCP-capable agents). Run: node tool-dist/mcp-stdio.mjs
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './mcp';

const server = buildMcpServer('local');
await server.connect(new StdioServerTransport());
// stdout is the protocol channel; log only to stderr
process.stderr.write('stimulus-association-map MCP server ready (stdio)\n');
