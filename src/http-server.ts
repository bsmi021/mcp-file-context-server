import * as http from 'node:http';
import * as crypto from 'node:crypto'; // For sessionIdGenerator
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport, StreamableHTTPServerTransportOptions, AuthInfo } from './transports/StreamableHTTPServerTransport.js';
import { InMemoryEventStore } from './eventStore/InMemoryEventStore.js';
import { fileContextServerInstance } from './index.js'; // Assuming FileContextServer instance is exported
import logger from './utils/logger.js';

const PORT = process.env.HTTP_PORT || 3000;

// Get the MCP Server instance from the existing FileContextServer
// This requires fileContextServerInstance to be exported from src/index.ts
// and to have a method to access the underlying McpServer.
if (!fileContextServerInstance || typeof fileContextServerInstance.getServer !== 'function') {
  logger.fatal('Failed to get fileContextServerInstance or its getServer method. Make sure it is correctly exported from src/index.ts');
  process.exit(1);
}
const mcpServer: McpServer = fileContextServerInstance.getServer();

const eventStore = new InMemoryEventStore();
const transportOptions: StreamableHTTPServerTransportOptions = {
  eventStore: eventStore,
  sessionIdGenerator: () => crypto.randomUUID(),
  enableJsonResponse: process.env.ENABLE_JSON_RESPONSE === 'true' || false, // Default to SSE
  onsessioninitialized: (sessionId, req) => {
    // Cast req to AuthenticatedRequest if necessary, though not strictly needed here
    logger.info({ sessionId, remoteAddress: req.socket?.remoteAddress }, "HTTP Session initialized");
  },
  onsessionresumed: (sessionId, req) => {
    logger.info({ sessionId, remoteAddress: req.socket?.remoteAddress }, "HTTP Session resumed");
  }
};
const httpTransport = new StreamableHTTPServerTransport(transportOptions);

// Connect the MCP Server to the HTTP transport
// The actual `connect` method might be on the transport, taking the server,
// or on the server, taking the transport. The SDK's `Server.connect(transport)` is assumed.
mcpServer.connect(httpTransport).then(() => {
  logger.info('MCP Server connected to HTTP Transport');
}).catch(err => {
  logger.error({ err }, 'Error connecting MCP Server to HTTP Transport');
  // Depending on severity, might want to exit
});

const httpServer = http.createServer(async (req, res) => {
  try {
    // Placeholder for future authentication middleware
    // const authInfo: AuthInfo = { userId: 'some-user' };
    // const authenticatedReq = Object.assign(req, { auth: authInfo });
    // await httpTransport.handleRequest(authenticatedReq, res);
    await httpTransport.handleRequest(req, res);
  } catch (e: any) {
    logger.error({ err: e, url: req.url, method: req.method }, 'Error handling HTTP request in top-level server');
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: 'Internal Server Error', message: e.message }));
    }
  }
});

httpServer.listen(PORT, () => {
  logger.info(`HTTP MCP Server listening on port ${PORT}`);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down HTTP server...');
  httpServer.close(async () => { // Changed to async
    logger.info('HTTP server closed.');
    try {
      await mcpServer.close(); // Assuming mcpServer.close() is async
      logger.info('MCP Server closed.');
    } catch (err) {
      logger.error({ err }, 'Error closing MCP server during shutdown.');
    } finally {
      process.exit(0);
    }
  });
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down HTTP server...');
  httpServer.close(async () => { // Changed to async
    logger.info('HTTP server closed.');
    try {
      await mcpServer.close(); // Assuming mcpServer.close() is async
      logger.info('MCP Server closed.');
    } catch (err) {
      logger.error({ err }, 'Error closing MCP server during shutdown.');
    } finally {
      process.exit(0);
    }
  });
});
