import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { ParsedMediaType } from 'content-type';
import * as contentType from 'content-type';
import getRawBody from 'raw-body';

import { Transport, TransportHandlers } from '@modelcontextprotocol/sdk/server/transport.js';
import {
    JSONRPC,
    JSONRPCID,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
    JSONRPCSuccessResponse,
    JSONRPCErrorResponse,
    ErrorCode as McpErrorCode
} from '@modelcontextprotocol/sdk/types';

import logger from '../utils/logger.js'; // Assuming logger is available

// --- Interfaces specific to this transport ---

export interface EventId extends String { _eventIdBrand: undefined }
export interface StreamId extends String { _streamIdBrand: undefined }

export interface EventStore {
  storeEvent(streamId: StreamId, message: JSONRPCResponse | JSONRPCNotification): Promise<EventId>;
  replayEventsAfter(
    lastEventId: EventId,
    handler: { send: (eventId: EventId, message: JSONRPCResponse | JSONRPCNotification) => Promise<void> }
  ): Promise<StreamId>;
}

export interface AuthInfo {
  userId?: string;
  // Add other auth-related properties as needed
}

export interface AuthenticatedRequest extends http.IncomingMessage {
  auth?: AuthInfo;
}

interface SseClient {
  req: AuthenticatedRequest;
  res: http.ServerResponse;
  sessionId: string;
  streamId: StreamId;
  sendEvent: (eventId: EventId, message: JSONRPCResponse | JSONRPCNotification) => Promise<void>;
  close: () => void;
}

export interface StreamableHTTPServerTransportOptions {
  eventStore: EventStore;
  sessionIdGenerator?: () => string;
  /** If true, POST requests get JSON responses instead of just 202/204. SSE is still preferred for streams. */
  enableJsonResponseForPost?: boolean;
  /** Called when a new SSE session is established (after potential replay) */
  onsessioninitialized?: (sessionId: string, req: AuthenticatedRequest) => void;
  /** Called when an existing SSE session is successfully resumed */
  onsessionresumed?: (sessionId: string, req: AuthenticatedRequest) => void;
  /** Max request body size for POST requests */
  maxRequestBodySize?: number;
}

export class StreamableHTTPServerTransport implements Transport {
  private handlers: TransportHandlers = {} as TransportHandlers;
  private readonly sseClients = new Map<string, SseClient>(); // sessionId -> SseClient
  public readonly options: StreamableHTTPServerTransportOptions;

  constructor(options: StreamableHTTPServerTransportOptions) {
    this.options = {
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponseForPost: false,
      maxRequestBodySize: 1024 * 1024, // 1MB default
      ...options,
    };
  }

  // --- Transport interface implementation ---
  get onmessage() { return this.handlers.onmessage; }
  set onmessage(handler: (message: JSONRPCMessage) => Promise<JSONRPCResponse | undefined | void>) { this.handlers.onmessage = handler; }

  get onclose() { return this.handlers.onclose; } // Called by SDK Server if it initiates close
  set onclose(handler: () => void) { this.handlers.onclose = handler; }

  get onerror() { return this.handlers.onerror; }
  set onerror(handler: (error: Error) => void) { this.handlers.onerror = handler; }

  public async send(message: JSONRPCResponse | JSONRPCNotification): Promise<void> {
    const sessionId = message.sessionId as string; // Assume sessionId is present
    if (!sessionId) {
      logger.warn({ message }, 'Attempted to send message without sessionId.');
      return;
    }

    const client = this.sseClients.get(sessionId);
    if (client) {
      try {
        const eventId = await this.options.eventStore.storeEvent(client.streamId, message);
        await client.sendEvent(eventId, message);
      } catch (err) {
        logger.error({ err, sessionId, messageId: message.id }, "Error storing/sending SSE event");
        // Optionally, if send fails, remove client? Or rely on heartbeat/onclose.
      }
    } else {
      // This can happen if enableJsonResponseForPost is true and this is the response to a POST.
      // However, this simple transport doesn't queue POST responses for retrieval.
      // For a full implementation, one might need a way to correlate POST responses.
      logger.warn({ sessionId, messageId: message.id }, `No active SSE client for session ID to send message. Message may be dropped if not a POST response.`);
    }
  }

  public async close(): Promise<void> {
    this.sseClients.forEach(client => client.close());
    this.sseClients.clear();
    logger.info('All SSE connections closed.');
  }

  // --- HTTP specific methods ---

  public async handleRequest(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const { method, url } = req;
    const requestPath = url?.split('?')[0] || '/'; // Basic path parsing

    // CORS Preflight
    if (method === 'OPTIONS') {
      this.handleOptionsRequest(res);
      return;
    }
    // Add common headers
    res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust for production

    if (method === 'GET' && (requestPath === '/events' || requestPath === '/')) { // Default to /events for GET
      await this.handleGetSseRequest(req, res);
    } else if (method === 'POST' && (requestPath === '/rpc' || requestPath === '/')) { // Default to /rpc for POST
      await this.handlePostJsonRpcRequest(req, res);
    } else {
      this.sendHttpError(res, 404, 'Not Found');
    }
  }

  private handleOptionsRequest(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*'); // Be more specific in production
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MCP-Session-ID, Last-Event-ID');
    res.writeHead(204); // No Content
    res.end();
  }

  private async handleGetSseRequest(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const sessionIdHeader = req.headers['x-mcp-session-id'] as string | undefined;
    const lastEventId = req.headers['last-event-id'] as EventId | undefined;

    let sessionId = sessionIdHeader || this.options.sessionIdGenerator!();
    let streamId: StreamId;
    let isResuming = false;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-MCP-Session-ID', sessionId);
    res.writeHead(200);
    res.write('\n'); // Start the stream

    const sendSseEvent = async (eventId: EventId, message: JSONRPCResponse | JSONRPCNotification) => {
      if (res.writableEnded) return;
      let payload = JSON.stringify(message);
      if (message.result && typeof message.result === 'object' && message.result.type === 'text_delta') {
         // For text_delta, just send the delta content directly as per some interpretations
         payload = message.result.text;
      } else if (message.result && typeof message.result === 'object' && message.result.type === 'text') {
         payload = message.result.text;
      } else {
         payload = JSON.stringify(message); // Default full JSON-RPC
      }
      res.write(`id: ${eventId}\nevent: message\ndata: ${payload}\n\n`);
    };

    try {
      if (lastEventId && sessionIdHeader) { // Attempt to resume
        logger.info({ sessionId, lastEventId }, 'Attempting to resume SSE session.');
        streamId = await this.options.eventStore.replayEventsAfter(lastEventId, { send: sendSseEvent });
        isResuming = true;
        if (this.options.onsessionresumed) {
          this.options.onsessionresumed(sessionId, req);
        }
        logger.info({ sessionId, streamId, lastEventId }, 'SSE session resumed.');
      } else {
        streamId = randomUUID() as StreamId; // New stream for this connection
        sessionId = this.options.sessionIdGenerator!(); // Ensure a new session ID if not resuming or no header
        res.setHeader('X-MCP-Session-ID', sessionId); // Update header if a new ID was generated
        if (this.options.onsessioninitialized) {
          this.options.onsessioninitialized(sessionId, req);
        }
        logger.info({ sessionId, streamId }, 'New SSE session initialized.');
      }
    } catch (error: any) {
      logger.error({ err: error, sessionId, lastEventId }, 'Error during SSE session resume/init.');
      const errorResponse: JSONRPCErrorResponse = {
        jsonrpc: JSONRPC.VERSION,
        id: null, // No specific request ID for this error
        error: { code: McpErrorCode.InternalError, message: `Session handling error: ${error.message}` },
        sessionId: sessionId,
      };
      // Can't use sendSseEvent here as eventStore might not have initialized streamId
      if (!res.writableEnded) {
        const eventId = randomUUID() as EventId;
        res.write(`id: ${eventId}\nevent: error\ndata: ${JSON.stringify(errorResponse)}\n\n`);
      }
      res.end();
      return;
    }

    const client: SseClient = {
      req,
      res,
      sessionId,
      streamId,
      sendEvent: sendSseEvent,
      close: () => {
        if (!res.writableEnded) res.end();
        this.sseClients.delete(sessionId);
        logger.info({ sessionId }, 'SSE client connection closed.');
        if (this.handlers.onclose) { // Notify the SDK Server if the transport initiated close
            // This specific onclose is tricky for SSE as client can just disappear.
            // SDK Server's onclose is more for when the server itself wants to close transport.
        }
      },
    };
    this.sseClients.set(sessionId, client);

    req.on('close', () => {
      client.close();
    });

    // Send a keep-alive ping periodically
    const keepAliveInterval = setInterval(() => {
        if (res.writableEnded) {
            clearInterval(keepAliveInterval);
            return;
        }
        res.write(':keep-alive\n\n');
    }, 30000); // every 30 seconds
  }

  private async handlePostJsonRpcRequest(req: AuthenticatedRequest, res: http.ServerResponse): Promise<void> {
    const sessionId = (req.headers['x-mcp-session-id'] as string) || this.options.sessionIdGenerator!();
    res.setHeader('X-MCP-Session-ID', sessionId); // Echo back session ID or new one

    let rawBodyBuffer: Buffer;
    try {
      const type = req.headers['content-type'] ? contentType.parse(req as http.IncomingMessage) : null;
      if (type?.type !== 'application/json') {
        return this.sendHttpError(res, 415, 'Unsupported Media Type: Expected application/json');
      }
      rawBodyBuffer = await getRawBody(req, {
        length: req.headers['content-length'],
        limit: this.options.maxRequestBodySize,
        encoding: type.parameters.charset || 'utf-8',
      });
    } catch (err: any) {
      logger.warn({ err, sessionId }, 'Error reading or parsing request body');
      return this.sendHttpError(res, err.type === 'entity.too.large' ? 413 : 400, err.message);
    }

    const body = rawBodyBuffer.toString();
    let rpcMessages: JSONRPCMessage | JSONRPCMessage[];
    try {
      rpcMessages = JSON.parse(body);
    } catch (err: any) {
      logger.warn({ err, body }, 'Invalid JSON body');
      return this.sendMcpErrorResponse(res, null, McpErrorCode.ParseError, 'Invalid JSON body');
    }

    const messagesArray = Array.isArray(rpcMessages) ? rpcMessages : [rpcMessages];
    const responses: (JSONRPCResponse | void)[] = [];

    for (const message of messagesArray) {
      if (!this.isValidJsonRpcRequest(message)) {
        responses.push(this.createErrorResponse(message.id || null, McpErrorCode.InvalidRequest, 'Invalid JSON-RPC request object'));
        continue;
      }
      message.sessionId = sessionId; // Inject sessionId
      if(req.auth) message.auth = req.auth; // Inject auth info

      try {
        const response = await this.handlers.onmessage(message);
        if (response) responses.push(response);
        // For notifications, onmessage might return void/undefined
      } catch (err: any) {
        logger.error({ err, messageId: message.id, sessionId }, 'Error processing message in onmessage handler');
        responses.push(this.createErrorResponse(message.id, McpErrorCode.InternalError, err.message || 'Internal server error'));
      }
    }

    if (this.options.enableJsonResponseForPost) {
        const validResponses = responses.filter(r => r !== undefined && r !== null) as JSONRPCResponse[];
        if (validResponses.length > 0) {
            if (!Array.isArray(rpcMessages) && validResponses.length === 1) {
                this.sendJsonResponse(res, 200, validResponses[0]);
            } else {
                this.sendJsonResponse(res, 200, validResponses);
            }
        } else {
             // If all were notifications or resulted in no direct response
            res.writeHead(204); // No Content
            res.end();
        }
    } else {
        // Default behavior for POST is to acknowledge receipt and send responses via SSE if applicable
        res.writeHead(202); // Accepted (client should listen on SSE for actual responses)
        res.end();
    }
  }

  private isValidJsonRpcRequest(message: any): message is JSONRPCRequest {
    return message && message.jsonrpc === JSONRPC.VERSION && message.method !== undefined && message.id !== undefined;
  }

  private createErrorResponse(id: JSONRPCID | null, code: McpErrorCode, message: string): JSONRPCErrorResponse {
    return {
      jsonrpc: JSONRPC.VERSION,
      id,
      error: { code, message },
    };
  }

  private sendHttpError(res: http.ServerResponse, statusCode: number, message: string): void {
    if (res.headersSent) {
        logger.warn({statusCode, message}, "Attempted to send HTTP error after headers were sent.");
        if(!res.writableEnded) res.end();
        return;
    }
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message, code: statusCode } }));
  }

  private sendMcpErrorResponse(res: http.ServerResponse, id: JSONRPCID | null, code: McpErrorCode, message: string): void {
    if (res.headersSent) {
        logger.warn({id, code, message}, "Attempted to send MCP error response after headers were sent.");
        if(!res.writableEnded) res.end();
        return;
    }
    const errorResponse = this.createErrorResponse(id, code, message);
    res.writeHead(code === McpErrorCode.ParseError || code === McpErrorCode.InvalidRequest ? 400 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse));
  }

  private sendJsonResponse(res: http.ServerResponse, statusCode: number, payload: any): void {
    if (res.headersSent) {
        logger.warn({payload}, "Attempted to send JSON response after headers were sent.");
        if(!res.writableEnded) res.end();
        return;
    }
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}
}
