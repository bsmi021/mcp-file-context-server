#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
    CreateMessageRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import { glob as globCb } from 'glob';
import type { IOptions } from 'glob';
import { promisify } from 'util';
import globPkg from 'glob';

import * as path from 'path';
import * as mime from 'mime-types';

const glob = promisify(globPkg) as (pattern: string, options?: IOptions) => Promise<string[]>;

import {
    FileContent,
    FileEntry,
    FileErrorCode,
    FileMetadata,
    FileOperationError,
    SearchOptions,
    SearchResult,
    DirectoryContent,
    EnhancedSearchOptions,
    CachedContent,
    CacheEntry
} from './types.js';
import { CacheService } from './services/CacheService.js';
import { CodeAnalysisService } from './services/CodeAnalysisService.js';
import { FileWatcherService } from './services/FileWatcherService.js';

class FileContextServer {
    private server: Server;
    private cacheService: CacheService;
    private codeAnalysisService: CodeAnalysisService;
    private fileWatcherService: FileWatcherService;

    /**
     * Create standardized file content object
     */
    private async createFileContent(content: string, metadata: FileMetadata, encoding: string = 'utf8'): Promise<FileContent> {
        return {
            content,
            metadata,
            encoding,
            truncated: false,
            totalLines: content.split('\n').length
        };
    }

    /**
     * Create standardized JSON response
     */
    private createJsonResponse(data: any) {
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(data, null, 2)
            }]
        };
    }

    /**
     * Handle file operation errors consistently
     */
    private handleFileOperationError(error: unknown, context: string, path: string): never {
        if (error instanceof FileOperationError) throw error;
        throw new FileOperationError(
            FileErrorCode.UNKNOWN_ERROR,
            `Failed to ${context}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            path
        );
    }

    /**
     * Get cached entry if valid, respecting size limits
     */
    private getCachedEntry(path: string, maxSize?: number): CacheEntry | null {
        const cachedEntry = this.cacheService.get(path);
        if (cachedEntry && (!maxSize || cachedEntry.content.metadata.size <= maxSize)) {
            return cachedEntry;
        }
        return null;
    }

    /**
     * Process and cache file content with analysis
     */
    private async processAndCacheFile(filePath: string, metadata: FileMetadata, encoding: string = 'utf8'): Promise<FileContent> {
        const { content } = await this.readFileWithEncoding(filePath, encoding);
        const fileContent = await this.createFileContent(content, metadata, encoding);

        if (this.isCodeFile(filePath)) {
            this.cacheService.set(filePath, fileContent, metadata.analysis);
        }

        return fileContent;
    }

    constructor() {
        // Initialize services
        this.cacheService = new CacheService({ maxSize: 1000 });
        this.codeAnalysisService = new CodeAnalysisService();
        this.fileWatcherService = new FileWatcherService(this.cacheService);

        this.server = new Server(
            {
                name: 'file-context-server',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                    prompts: {},
                    sampling: {},
                    transports: {
                        stdio: {},
                        sse: {},
                        websocket: {}
                    }
                },
            }
        );

        this.setupHandlers();

        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.cleanup();
            process.exit(0);
        });

        // Setup file watcher event handlers
        this.fileWatcherService.on('fileChanged', async (filePath) => {
            try {
                // Re-analyze changed files
                if (this.isCodeFile(filePath)) {
                    const content = await fs.readFile(filePath, 'utf8');
                    const analysis = this.codeAnalysisService.analyze(content, filePath);
                    const metadata = await this.getFileMetadata(filePath);
                    const fileContent: FileContent = {
                        content,
                        metadata: { ...metadata, analysis },
                        encoding: 'utf8',
                        truncated: false,
                        totalLines: content.split('\n').length
                    };
                    this.cacheService.set(filePath, fileContent, analysis);
                }
            } catch (error) {
                console.error(`Error processing file change for ${filePath}:`, error);
            }
        });
    }

    /**
     * Cleanup resources before shutdown
     */
    private async cleanup(): Promise<void> {
        await this.fileWatcherService.close();
        this.cacheService.clear();
        await this.server.close();
    }

    /**
     * Check if file is a code file that should be analyzed
     */
    private isCodeFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cs', '.go', '.rb', '.md', '.mdx'].includes(ext);
    }

    /**
     * Validate file access permissions and resolve path
     */
    private async validateAccess(filePath: string): Promise<string> {
        const resolvedPath = path.resolve(process.cwd(), filePath);
        try {
            await fs.access(resolvedPath);
            return resolvedPath;
        } catch (error) {
            console.error(`Access validation failed for path: ${resolvedPath}`, error);
            throw new FileOperationError(
                FileErrorCode.INVALID_PATH,
                `Path does not exist or is not accessible: ${resolvedPath}`,
                resolvedPath
            );
        }
    }

    /**
     * Read file with encoding detection
     */
    private async readFileWithEncoding(filePath: string, encoding: string = 'utf8'): Promise<{ content: string, encoding: string }> {
        const buffer = await fs.readFile(filePath);

        // Try to detect UTF-16 BOM
        if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
            return {
                content: buffer.toString('utf16le'),
                encoding: 'utf16le'
            };
        }

        return {
            content: buffer.toString(encoding as BufferEncoding),
            encoding
        };
    }

    private setupHandlers() {
        // Set up prompts handlers
        this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
            prompts: [
                {
                    name: 'analyze-file',
                    description: 'Analyze a file for code quality and potential improvements',
                    arguments: [
                        {
                            name: 'path',
                            description: 'Path to the file to analyze',
                            required: true
                        }
                    ]
                },
                {
                    name: 'read_context',
                    description: 'Read file or directory contents into model context',
                    arguments: [
                        {
                            name: 'path',
                            description: 'Path to the file or directory to read',
                            required: true
                        },
                        {
                            name: 'recursive',
                            description: 'Whether to read directories recursively',
                            required: false
                        },
                        {
                            name: 'fileTypes',
                            description: 'File extensions to include (e.g. "ts,js" or ["ts","js"])',
                            required: false
                        }
                    ]
                },
                {
                    name: 'search-files',
                    description: 'Search through files with context',
                    arguments: [
                        {
                            name: 'pattern',
                            description: 'Search pattern to look for',
                            required: true
                        },
                        {
                            name: 'path',
                            description: 'Directory to search in',
                            required: true
                        }
                    ]
                }
            ]
        }));

        this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
            switch (request.params.name) {
                case 'analyze-file':
                    return {
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text: `Please analyze this file for code quality and potential improvements:\n\n${request.params.arguments?.path}`
                                }
                            }
                        ]
                    };
                case 'read_context':
                    return {
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text: `Reading contents from ${request.params.arguments?.path} for context analysis...`
                                }
                            }
                        ]
                    };
                case 'search-files':
                    return {
                        messages: [
                            {
                                role: 'user',
                                content: {
                                    type: 'text',
                                    text: `Search for "${request.params.arguments?.pattern}" in ${request.params.arguments?.path} and provide context around matches.`
                                }
                            }
                        ]
                    };
                default:
                    throw new McpError(
                        ErrorCode.MethodNotFound,
                        `Unknown prompt: ${request.params.name}`
                    );
            }
        });

        // Set up sampling handler
        this.server.setRequestHandler(CreateMessageRequestSchema, async (request) => {
            const { messages, systemPrompt, includeContext } = request.params;

            // Validate request
            if (!messages || messages.length === 0) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    'Messages array is required and cannot be empty'
                );
            }

            // Add context based on includeContext parameter
            const contextMessages = [];
            if (includeContext === 'thisServer' || includeContext === 'allServers') {
                const cachedFiles = this.cacheService.get('last_read_result');
                if (cachedFiles) {
                    contextMessages.push({
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Available cached files:\n${JSON.stringify(cachedFiles, null, 2)}`
                        }
                    });
                }
            }

            return {
                messages: [
                    ...(systemPrompt ? [{
                        role: 'system',
                        content: {
                            type: 'text',
                            text: systemPrompt
                        }
                    }] : []),
                    ...contextMessages,
                    ...messages
                ]
            };
        });

        // Set up tool handlers
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'list_context_files',
                    description: 'List files in a directory with detailed metadata for context',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Directory path to list files from',
                            },
                            recursive: {
                                type: 'boolean',
                                description: 'Whether to list files recursively',
                                default: false,
                            },
                            includeHidden: {
                                type: 'boolean',
                                description: 'Whether to include hidden files',
                                default: false,
                            },
                        },
                        required: ['path'],
                    },
                },
                {
                    name: 'read_context',
                    description: 'Read file or directory contents with metadata for context analysis',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Path to the file or directory to read',
                            },
                            encoding: {
                                type: 'string',
                                description: 'File encoding (default: utf8)',
                                default: 'utf8',
                            },
                            maxSize: {
                                type: 'number',
                                description: 'Maximum size in bytes per file',
                            },
                            recursive: {
                                type: ['boolean', 'string'],
                                description: 'Whether to read directories recursively',
                                default: false,
                            },
                            fileTypes: {
                                oneOf: [
                                    {
                                        type: 'array',
                                        items: { type: 'string' }
                                    },
                                    { type: 'string' }
                                ],
                                description: 'File extensions to include (e.g. ["ts", "js"], "py", or "ts,js,py")',
                            },
                            maxFiles: {
                                type: 'number',
                                description: 'Maximum number of files to read',
                            },
                        },
                        required: ['path'],
                    },
                },
                {
                    name: 'search_context',
                    description: 'Search for text patterns in files with surrounding context',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            pattern: {
                                type: 'string',
                                description: 'Text pattern to search for (regex supported)',
                            },
                            path: {
                                type: 'string',
                                description: 'Directory path to search in',
                            },
                            options: {
                                type: 'object',
                                description: 'Search options',
                                properties: {
                                    recursive: {
                                        type: 'boolean',
                                        default: true,
                                    },
                                    includeHidden: {
                                        type: 'boolean',
                                        default: false,
                                    },
                                    maxDepth: {
                                        type: 'number',
                                    },
                                    fileTypes: {
                                        type: 'array',
                                        items: {
                                            type: 'string',
                                        },
                                    },
                                },
                            },
                        },
                        required: ['pattern', 'path'],
                    },
                },
                {
                    name: 'list_cached_files',
                    description: 'List files from the last read operation',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                    },
                },
                {
                    name: 'analyze_code',
                    description: 'Analyze code files for insights and metrics',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Path to file or directory to analyze'
                            },
                            recursive: {
                                type: 'boolean',
                                description: 'Whether to analyze directories recursively',
                                default: false
                            },
                            metrics: {
                                type: 'array',
                                items: {
                                    type: 'string',
                                    enum: ['complexity', 'dependencies', 'quality', 'all']
                                },
                                description: 'Metrics to analyze'
                            }
                        },
                        required: ['path']
                    }
                },
                {
                    name: 'cache_stats',
                    description: 'Get cache statistics and performance metrics',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            detailed: {
                                type: 'boolean',
                                description: 'Include detailed cache entry information',
                                default: false
                            }
                        }
                    }
                }
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                switch (request.params.name) {
                    case 'list_context_files':
                        return await this.handleListFiles(request.params.arguments);
                    case 'read_context': {
                        const args = request.params.arguments;
                        if (!args || typeof args !== 'object' || !('path' in args)) {
                            throw new McpError(
                                ErrorCode.InvalidParams,
                                'Invalid arguments for read_context: path is required'
                            );
                        }
                        return await this.handleReadFile(args as {
                            path: string;
                            encoding?: string;
                            maxSize?: number;
                            recursive?: boolean | string;
                            fileTypes?: string | string[];
                            maxFiles?: number;
                        });
                    }
                    case 'search_context':
                        return await this.handleSearchFiles(request.params.arguments);
                    case 'list_cached_files':
                        return await this.handleListCachedFiles();
                    case 'analyze_code':
                        return await this.handleAnalyzeCode(request.params.arguments);
                    case 'cache_stats':
                        return await this.handleCacheStats(request.params.arguments);
                    default:
                        throw new McpError(
                            ErrorCode.MethodNotFound,
                            `Unknown tool: ${request.params.name}`
                        );
                }
            } catch (error) {
                if (error instanceof FileOperationError) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `File operation error: ${error.message} (${error.code})`,
                            },
                        ],
                        isError: true,
                    };
                }
                throw error;
            }
        });
    }

    private async getFileMetadata(filePath: string): Promise<FileMetadata> {
        try {
            const stats = await fs.stat(filePath);
            const metadata: FileMetadata = {
                size: stats.size,
                mimeType: mime.lookup(filePath) || 'application/octet-stream',
                modifiedTime: stats.mtime.toISOString(),
                createdTime: stats.birthtime.toISOString(),
                isDirectory: stats.isDirectory(),
            };

            // Add code analysis for supported file types
            if (!stats.isDirectory() && this.isCodeFile(filePath)) {
                const { content } = await this.readFileWithEncoding(filePath, 'utf8');
                metadata.analysis = this.codeAnalysisService.analyze(content, filePath);
                metadata.lastAnalyzed = new Date().toISOString();
            }

            return metadata;
        } catch (error) {
            throw new FileOperationError(
                FileErrorCode.FILE_NOT_FOUND,
                `Failed to get metadata for ${filePath}`,
                filePath
            );
        }
    }

    private async globPromise(pattern: string, options: any): Promise<string[]> {
        try {
            // Convert to absolute path first
            const absolutePath = path.resolve(pattern);

            // Convert to posix path for glob (always use forward slashes)
            const globPattern = absolutePath.split(path.sep).join(path.posix.sep);
            console.error(`Glob pattern: ${globPattern}`);

            // Add .meta to ignore list if not already present
            const ignore = [...(options.ignore || [])];
            if (!ignore.includes('**/*.meta')) {
                ignore.push('**/*.meta');
            }

            const result = await glob(globPattern, {
                ...options,
                ignore,
                withFileTypes: false,
                windowsPathsNoEscape: true,
                absolute: true
            });

            const paths = Array.isArray(result) ? result : [result];
            console.error(`Glob found ${paths.length} paths`);

            // Convert paths back to OS-specific format
            return paths.map(entry => path.normalize(entry.toString()));
        } catch (error) {
            console.error('Glob error:', error);
            throw new FileOperationError(
                FileErrorCode.UNKNOWN_ERROR,
                `Glob operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                pattern
            );
        }
    }

    private async handleListFiles(args: any) {
        const { path: dirPath, recursive = false, includeHidden = false } = args;

        try {
            await this.validateAccess(dirPath);
            await this.fileWatcherService.watch(dirPath);

            const entries: FileEntry[] = [];
            // Normalize directory path and create glob pattern
            const normalizedDirPath = path.normalize(dirPath);
            const pattern = recursive ? '**/*' : '*';
            const globPattern = path.join(normalizedDirPath, pattern);

            console.error(`Directory path: ${normalizedDirPath}`);
            console.error(`Glob pattern: ${globPattern}`);

            const files = await this.globPromise(globPattern, {
                ignore: includeHidden ? [] : ['.*', '**/.*'],
                nodir: false,
                dot: includeHidden
            });
            console.error(`Found files: ${files.length}`);

            for (const file of files) {
                try {
                    const fullPath = path.join(dirPath, file);
                    // Check cache first
                    const cachedEntry = this.cacheService.get(fullPath);
                    if (cachedEntry) {
                        entries.push({
                            path: fullPath,
                            name: path.basename(fullPath),
                            metadata: cachedEntry.content.metadata,
                        });
                        continue;
                    }

                    // Get fresh metadata if not cached
                    const metadata = await this.getFileMetadata(fullPath);

                    // Cache the result if it's a code file
                    if (this.isCodeFile(fullPath)) {
                        const { content } = await this.readFileWithEncoding(fullPath, 'utf8');
                        const fileContent: FileContent = {
                            content,
                            metadata,
                            encoding: 'utf8',
                            truncated: false,
                            totalLines: content.split('\n').length
                        };
                        this.cacheService.set(fullPath, fileContent, metadata.analysis);
                    }

                    entries.push({
                        path: fullPath,
                        name: path.basename(fullPath),
                        metadata,
                    });
                } catch (error) {
                    console.error(`Error getting metadata for ${file}: ${error}`);
                }
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(entries, null, 2),
                    },
                ],
            };
        } catch (error: unknown) {
            console.error(`List files error: ${error}`);
            if (error instanceof FileOperationError) throw error;
            throw new FileOperationError(
                FileErrorCode.INVALID_PATH,
                `Failed to list files in ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                dirPath
            );
        }
    }

    /**
     * Process file types argument into a standardized array
     */
    private processFileTypes(fileTypes: string | string[] | undefined): string[] | undefined {
        if (!fileTypes) return undefined;

        // If it's already an array, clean each item
        if (Array.isArray(fileTypes)) {
            return fileTypes
                .map(type => String(type)
                    .replace(/[\[\]"'`{}()]/g, '')
                    .trim())
                .filter(type => type.length > 0);
        }

        if (typeof fileTypes === 'string') {
            // Remove all brackets and special characters first
            const cleaned = fileTypes.replace(/[\[\]"'`{}()]/g, '');
            // Split on commas and clean each part
            return cleaned
                .split(',')
                .map(type => type.trim())
                .filter(type => type.length > 0);
        }

        return undefined;
    }

    /**
     * Process directory contents with caching and filtering
     */
    private async processDirectory(
        filePath: string,
        isRecursive: boolean,
        fileTypeArray?: string[],
        maxFiles?: number,
        maxSize?: number,
        encoding: string = 'utf8'
    ): Promise<{
        files: { [path: string]: FileContent };
        totalSize: number;
        totalFiles: number;
        truncated: boolean;
        searchPath: string;
    }> {
        const files: { [path: string]: FileContent } = {};
        let totalSize = 0;
        let totalFiles = 0;
        let truncated = false;

        const pattern = isRecursive ? '**/*' : '*';
        const searchPath = path.resolve(filePath);

        console.error(`Searching with pattern: ${path.join(searchPath, pattern)}`);

        let allFiles = await this.globPromise(path.join(searchPath, pattern), {
            ignore: ['**/node_modules/**'],
            nodir: true,
            dot: true,
            windowsPathsNoEscape: true
        });

        // Apply file type filtering
        if (fileTypeArray?.length) {
            allFiles = allFiles.filter(file => {
                const ext = path.extname(file).slice(1).toLowerCase();
                return fileTypeArray.includes(ext);
            });
        }

        // Apply file limit
        const filesToProcess = maxFiles ? allFiles.slice(0, maxFiles) : allFiles;
        truncated = maxFiles ? allFiles.length > maxFiles : false;

        for (const file of filesToProcess) {
            try {
                // Try cache first
                const cachedEntry = this.getCachedEntry(file, maxSize);
                if (cachedEntry) {
                    files[file] = cachedEntry.content;
                    totalSize += cachedEntry.content.metadata.size;
                    totalFiles++;
                    continue;
                }

                const fileMetadata = await this.getFileMetadata(file);
                if (maxSize && fileMetadata.size > maxSize) {
                    console.error(`Skipping ${file}: exceeds size limit`);
                    continue;
                }

                const fileContent = await this.processAndCacheFile(file, fileMetadata, encoding);
                files[file] = fileContent;
                totalSize += fileMetadata.size;
                totalFiles++;
            } catch (error) {
                console.error(`Error processing file ${file}:`, error);
            }
        }

        return { files, totalSize, totalFiles, truncated, searchPath };
    }

    private async handleReadFile(args: {
        path: string;
        encoding?: string;
        maxSize?: number;
        recursive?: boolean | string;
        fileTypes?: string | string[];
        maxFiles?: number;
    }) {
        const {
            path: filePath,
            encoding = 'utf8',
            maxSize,
            recursive = false,
            fileTypes,
            maxFiles
        } = args;

        // Convert recursive string to boolean and process file types
        const isRecursive = recursive === true || recursive === 'true';
        const fileTypeArray = this.processFileTypes(fileTypes);

        // Debug logging
        console.error('========== Read Context Request ==========');
        console.error(`Path: ${filePath}`);
        console.error(`File types: ${JSON.stringify(fileTypeArray)}`);
        console.error(`Recursive: ${isRecursive}`);
        console.error(`Max files: ${maxFiles}`);
        console.error(`Max size: ${maxSize}`);
        console.error('=======================================');

        try {
            await this.validateAccess(filePath);
            await this.fileWatcherService.watch(filePath);

            const metadata = await this.getFileMetadata(filePath);

            if (metadata.isDirectory) {
                const { files, totalSize, totalFiles, truncated, searchPath } = await this.processDirectory(
                    filePath,
                    isRecursive,
                    fileTypeArray,
                    maxFiles,
                    maxSize,
                    encoding
                );

                const response = {
                    files,
                    metadata: {
                        totalFiles,
                        totalSize,
                        truncated,
                        searchPath,
                        fileTypes: fileTypeArray,
                        timestamp: new Date().toISOString()
                    }
                };

                // Cache for searching
                this.cacheService.set('last_read_result', await this.createFileContent(
                    JSON.stringify(response),
                    {
                        size: totalSize,
                        mimeType: 'application/json',
                        modifiedTime: new Date().toISOString(),
                        createdTime: new Date().toISOString(),
                        isDirectory: false
                    }
                ));

                return this.createJsonResponse(response);
            } else {
                // Handle single file reading
                // Check cache first
                const cachedEntry = this.cacheService.get(filePath);
                if (cachedEntry && (!maxSize || cachedEntry.content.metadata.size <= maxSize)) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: JSON.stringify(cachedEntry.content, null, 2),
                            },
                        ],
                    };
                }

                if (maxSize && metadata.size > maxSize) {
                    throw new FileOperationError(
                        FileErrorCode.FILE_TOO_LARGE,
                        `File size ${metadata.size} exceeds maximum ${maxSize}`,
                        filePath
                    );
                }

                const { content, encoding: fileEncoding } = await this.readFileWithEncoding(filePath, encoding);

                const fileContent: FileContent = {
                    content,
                    metadata,
                    encoding: fileEncoding,
                    truncated: false,
                    totalLines: content.split('\n').length
                };

                // Cache the content if it's a code file
                if (this.isCodeFile(filePath)) {
                    this.cacheService.set(filePath, fileContent, metadata.analysis);
                }

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(fileContent, null, 2),
                        },
                    ],
                };
            }
        } catch (error: unknown) {
            if (error instanceof FileOperationError) throw error;
            if (error instanceof Error) {
                throw new FileOperationError(
                    FileErrorCode.UNKNOWN_ERROR,
                    `Failed to read ${filePath}: ${error.message}`,
                    filePath
                );
            }
            throw new FileOperationError(
                FileErrorCode.UNKNOWN_ERROR,
                `Failed to read ${filePath}: Unknown error`,
                filePath
            );
        }
    }

    private async handleSearchFiles(args: any) {
        // Add ability to search cached results
        if (args.path === 'last_read_result') {
            const cachedResult = this.cacheService.get('last_read_result');
            if (!cachedResult) {
                throw new FileOperationError(
                    FileErrorCode.FILE_NOT_FOUND,
                    'No previous read results found. Please read a directory first.',
                    'last_read_result'
                );
            }
            if (cachedResult as CacheEntry === undefined) {
                throw new FileOperationError(
                    FileErrorCode.UNKNOWN_ERROR,
                    'Cached result is empty or invalid',
                    'last_read_result'
                )
            }

            // Search through the cached files
            const content = cachedResult.content.content;
            if (typeof content === 'string') {
                throw new FileOperationError(
                    FileErrorCode.UNKNOWN_ERROR,
                    'Cached result has invalid format',
                    'last_read_result'
                );
            }

            const matches: SearchResult['matches'] = [];
            let totalMatches = 0;

            console.error('Searching through cached results...');

            // Type guard to ensure content is CachedContent
            if (!content || typeof content === 'string' || !('files' in content)) {
                throw new FileOperationError(
                    FileErrorCode.UNKNOWN_ERROR,
                    'Cached result has invalid format',
                    'last_read_result'
                );
            }

            for (const [filePath, fileContent] of Object.entries(content.files)) {
                const fileContentStr = typeof fileContent.content === 'string'
                    ? fileContent.content
                    : JSON.stringify(fileContent.content);
                // Split on both \r\n and \n to handle different line endings
                const lines = fileContentStr.split(/\r?\n/);
                const regex = new RegExp(args.pattern);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (regex.test(line)) {
                        totalMatches++;
                        matches.push({
                            path: filePath,
                            line: i + 1,
                            content: lines[i],
                            context: {
                                before: lines.slice(Math.max(0, i - 2), i),
                                after: lines.slice(i + 1, Math.min(lines.length, i + 3)),
                            },
                        });
                    }
                }
            }

            console.error(`Found ${totalMatches} matches in cached results`);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ matches, totalMatches }, null, 2),
                    },
                ],
            };
        }

        const { pattern, path: searchPath, options = {} } = args;
        const searchOptions: EnhancedSearchOptions = {
            recursive: true,
            includeHidden: false,
            contextLines: 2,
            ...options,
        };

        try {
            await this.validateAccess(searchPath);
            await this.fileWatcherService.watch(searchPath);

            const regex = new RegExp(pattern, 'g');
            const globPattern = searchOptions.recursive ? '**/*' : '*';
            const files = await this.globPromise(path.join(searchPath, globPattern), {
                ignore: searchOptions.includeHidden ? [] : ['.*', '**/.*'],
                nodir: true,
                dot: searchOptions.includeHidden
            });
            const fullPaths = files.map(file => path.join(searchPath, file));

            const matches: SearchResult['matches'] = [];
            let totalMatches = 0;

            for (const file of fullPaths) {
                // Apply file type and exclusion filters
                if (searchOptions.fileTypes &&
                    !searchOptions.fileTypes.includes(path.extname(file).slice(1))) {
                    continue;
                }
                if (searchOptions.excludePatterns &&
                    searchOptions.excludePatterns.some(pattern =>
                        new RegExp(pattern).test(file))) {
                    continue;
                }

                // Check cache first
                // Get content from cache or file
                let content: string;
                const cachedEntry = this.cacheService.get(file);

                if (cachedEntry) {
                    content = typeof cachedEntry.content.content === 'string'
                        ? cachedEntry.content.content
                        : JSON.stringify(cachedEntry.content.content);
                } else {
                    const { content: fileContent } = await this.readFileWithEncoding(file, 'utf8');
                    content = fileContent;

                    // Cache code files for future searches
                    if (this.isCodeFile(file)) {
                        const metadata = await this.getFileMetadata(file);
                        const fileContent: FileContent = {
                            content,
                            metadata,
                            encoding: 'utf8',
                            truncated: false,
                            totalLines: content.split(/\r?\n/).length
                        };
                        this.cacheService.set(file, fileContent, metadata.analysis);
                    }
                }

                // Split content into lines, handling different line endings
                const lines = content.split(/\r?\n/);

                // Create regex without global flag to avoid lastIndex issues
                const regex = new RegExp(pattern);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (regex.test(line)) {
                        totalMatches++;
                        matches.push({
                            path: file,
                            line: i + 1,
                            content: line,
                            context: {
                                before: lines.slice(Math.max(0, i - (searchOptions.contextLines || 2)), i),
                                after: lines.slice(i + 1, Math.min(lines.length, i + 1 + (searchOptions.contextLines || 2))),
                            },
                        });
                    }
                }
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({ matches, totalMatches } as SearchResult, null, 2),
                    },
                ],
            };
        } catch (error: unknown) {
            if (error instanceof Error) {
                throw new FileOperationError(
                    FileErrorCode.UNKNOWN_ERROR,
                    `Search failed: ${error.message}`,
                    searchPath
                );
            }
            throw new FileOperationError(
                FileErrorCode.UNKNOWN_ERROR,
                'Search failed: Unknown error',
                searchPath
            );
        }
    }

    // Add a new method to list cached results
    private async handleAnalyzeCode(args: any) {
        const { path: targetPath, recursive = false, metrics = ['all'] } = args;

        try {
            await this.validateAccess(targetPath);
            const stats = await fs.stat(targetPath);

            if (stats.isDirectory() && recursive) {
                const pattern = path.join(targetPath, '**/*');
                const files = await this.globPromise(pattern, {
                    nodir: true,
                    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
                });

                const results = await Promise.all(
                    files
                        .filter(file => this.isCodeFile(file))
                        .map(async file => {
                            const content = await fs.readFile(file, 'utf8');
                            const analysis = this.codeAnalysisService.analyze(content, file);
                            return { file, analysis };
                        })
                );

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(results, null, 2)
                    }]
                };
            } else if (!stats.isDirectory() && this.isCodeFile(targetPath)) {
                const content = await fs.readFile(targetPath, 'utf8');
                const analysis = this.codeAnalysisService.analyze(content, targetPath);

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ file: targetPath, analysis }, null, 2)
                    }]
                };
            }

            throw new FileOperationError(
                FileErrorCode.INVALID_PATH,
                'Target must be a code file or directory',
                targetPath
            );
        } catch (error) {
            if (error instanceof FileOperationError) throw error;
            throw new FileOperationError(
                FileErrorCode.UNKNOWN_ERROR,
                `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                targetPath
            );
        }
    }

    private async handleCacheStats(args: any) {
        const { detailed = false } = args;
        const stats = this.cacheService.getStats();

        if (detailed) {
            const entries = this.cacheService.getEntries();
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        stats,
                        entries: entries.map(entry => ({
                            key: entry.key,
                            size: entry.size,
                            lastAccessed: entry.lastAccessed,
                            hits: entry.hits
                        }))
                    }, null, 2)
                }]
            };
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify(stats, null, 2)
            }]
        };
    }

    private async handleListCachedFiles() {
        try {
            const cachedResult = this.cacheService.get('last_read_result');
            if (!cachedResult) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                error: 'No cached results found. Please read a directory first.',
                                tip: 'Use read_context tool to cache file contents before listing',
                                cacheStats: this.cacheService.getStats()
                            }, null, 2),
                        },
                    ],
                };
            }

            // Type guard for CachedContent
            const isCachedContent = (content: any): content is CachedContent => {
                return content && typeof content === 'object' && 'files' in content && 'metadata' in content;
            };

            const cachedContent = cachedResult.content.content;
            if (!cachedContent || typeof cachedContent === 'string' || !isCachedContent(cachedContent)) {
                console.error('Invalid cache structure:', cachedResult);
                throw new FileOperationError(
                    FileErrorCode.UNKNOWN_ERROR,
                    'Cached result has invalid format',
                    'last_read_result'
                );
            }

            const { files, metadata } = cachedContent;

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            files: Object.keys(files).map(path => ({
                                path,
                                size: files[path].metadata.size,
                                type: files[path].metadata.mimeType,
                                lastModified: files[path].metadata.modifiedTime
                            })),
                            metadata: {
                                ...metadata,
                                cacheStats: this.cacheService.getStats(),
                                lastModified: cachedResult.lastModified
                            }
                        }, null, 2),
                    },
                ],
            };
        } catch (error) {
            console.error('Error listing cached files:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            error: 'Failed to retrieve cached files',
                            details: error instanceof Error ? error.message : 'Unknown error',
                            cacheStats: this.cacheService.getStats()
                        }, null, 2),
                    },
                ],
            };
        }
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('File Context MCP server running on stdio');
    }
}

const server = new FileContextServer();
server.run().catch(console.error);
