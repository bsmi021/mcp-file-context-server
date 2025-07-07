## FEATURE:

Implementation of streamableHTTP API endpoints for the Model Context Protocol (MCP) using the TypeScript SDK (@modelcontextprotocol/sdk). This feature enables MCP servers to support remote HTTP communication through a modern "Streamable HTTP" transport that unifies client-to-server messaging and server-to-client streaming into a single endpoint architecture. This replaces the previous HTTP+SSE dual-endpoint approach while maintaining backward compatibility for existing SSE clients.

## EXAMPLES:

[Provide and explain examples that you have in the `examples/` folder]

- https://modelcontextprotocol.io/docs/concepts/transports

## DOCUMENTATION:

[List out any documentation (web pages, sources for an MCP server like Crawl4AI RAG, etc.) that will need to be referenced during development]

### Core MCP Resources:
@./docs/mcp-typescript-readme.md
@./docs/technical-design.md
@./docs/llms-full.txt

### Official Specification:
- https://spec.modelcontextprotocol.io/specification/
- https://github.com/modelcontextprotocol/specification/pull/206 (StreamableHTTP RFC)

### TypeScript SDK Documentation:
- https://www.npmjs.com/package/@modelcontextprotocol/sdk
- https://github.com/modelcontextprotocol/typescript-sdk

### HTTP Transport Guides:
- Building Your First Model Context Protocol Server: https://thenewstack.io/building-your-first-model-context-protocol-server/
- Understanding MCP Recent Change Around HTTP+SSE: https://blog.christianposta.com/ai/understanding-mcp-recent-change-around-http-sse/

### Real-time Communication References:
- Server-Sent Events (SSE) specification: https://html.spec.whatwg.org/multipage/server-sent-events.html
- Express.js SSE middleware patterns
- HTTP streaming and content negotiation standards

## OTHER CONSIDERATIONS:

[Any other considerations or specific requirements - great place to include gotchas that you see AI coding assistants miss with your projects a lot]

### Protocol Evolution & Compatibility:
- **Backward Compatibility Critical**: Must support existing SSE clients during transition period
- **Session Management**: Server-generated session IDs for stateful connections vs stateless operation modes  
- **Content Negotiation**: Proper handling of Accept headers to determine JSON vs SSE response format
- **Error Handling**: Graceful degradation when clients don't support streamable responses

### Express.js Integration Gotchas:
- **CORS Configuration**: Must expose 'mcp-session-id' header for cross-origin requests
- **Body Parser Limits**: Ensure JSON payload size limits accommodate large tool responses
- **Streaming Response Handling**: Proper cleanup of SSE connections on client disconnect
- **Load Balancer Compatibility**: Session sticky routing or Redis-based session storage for horizontally scaled deployments

### Security & Infrastructure:
- **DNS Rebinding Protection**: Enable allowedHosts/allowedOrigins validation for production
- **Authentication Integration**: Bearer token support in Authorization headers for each request
- **Rate Limiting**: Apply appropriate throttling for streaming endpoints to prevent abuse
- **Proxy Support**: Ensure compatibility with reverse proxies and CDN edge deployments

### Performance Optimizations:
- **Connection Pooling**: Manage SSE connection lifecycle efficiently
- **Buffering Strategy**: Balance between real-time responsiveness and resource utilization
- **Memory Management**: Prevent memory leaks from long-lived streaming connections
- **Compression Support**: gzip/deflate for JSON responses, streaming-friendly compression for SSE

### Development & Testing:
- **Local Development**: Use tools like MCP Inspector for debugging streamable connections
- **Integration Testing**: Verify behavior with both stateful and stateless server configurations  
- **Browser Compatibility**: Test EventSource API behavior across different browsers
- **Network Resilience**: Handle reconnection scenarios and connection state management

### Migration Strategy:
- **Dual Transport Support**: Run both old HTTP+SSE and new StreamableHTTP during transition
- **Client Detection**: Implement feature detection to route to appropriate transport
- **Monitoring**: Track usage patterns to determine when legacy SSE support can be deprecated
- **Documentation**: Provide clear migration guide for existing MCP server implementations
