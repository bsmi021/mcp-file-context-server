## FEATURE:

A new MCP server tool to accept an array of filenames (and paths) and the tool quickly retreives each file and appends them to a result set. The result set should be a fixed schema that is predictable for the MCP client to work with. The point of this feature is to allow a MCP client to provide a list of file names to the MCP server, and the MCP server uses the paths to retrieve the files, the file information is then converted to the response object type and returned to the client.

## EXAMPLES:

[Provide and explain examples that you have in the `examples/` folder]

- getFiles_request_schema.json: request schema for retrieving files
- getFiles_response_schema.json: response schema for new tool, provides attributes for all relevant information

## DOCUMENTATION:

[List out any documentation (web pages, sources for an MCP server like Crawl4AI RAG, etc.) that will need to be referenced during development]
@./docs/llms-full.txt
@./docs/mcp-typescript-readme.md

## OTHER CONSIDERATIONS:

[Any other considerations or specific requirements - great place to include gotchas that you see AI coding assistants miss with your projects a lot]
