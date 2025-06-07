#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import { createReadStream, ReadStream } from 'fs';
import { createGzip, Gzip } from 'zlib';
import { pipeline, Transform } from 'stream';
import { glob as globAsync } from 'glob';
import * as path from 'path';
import * as mime from 'mime-types';
import { createHash } from 'crypto';
import {
    FileMetadata,
    FileContent,
    FileEntry,
    FileErrorCode,
    FileOperationError,
    SearchResult,
    FileOutline,
} from './types.js';
import logger from './utils/logger.js';
import { getLanguageFromExtension, getFileType, isMediaFile } from './utils/fileUtils.js';
import { FileWatcherService } from './services/FileWatcherService.js';
import { ProfileService } from './services/ProfileService.js';

// Helper function for parsing cache configuration (exported for testing)
export function parseCacheConfig(env: NodeJS.ProcessEnv, loggerInstance: typeof logger): { max: number; ttl: number } {
    const defaultMaxCacheItems = 500;
    const defaultCacheTTL = 1000 * 60 * 5; // 5 minutes

    let maxCacheItems = defaultMaxCacheItems;
    const maxCacheSizeEnv = env.MAX_CACHE_SIZE;
    if (maxCacheSizeEnv) {
        const parsedMax = parseInt(maxCacheSizeEnv, 10);
        if (!isNaN(parsedMax) && parsedMax > 0) {
            maxCacheItems = parsedMax;
        } else {
                loggerInstance.warn({ envVar: 'MAX_CACHE_SIZE', value: maxCacheSizeEnv, default: defaultMaxCacheItems }, `Invalid MAX_CACHE_SIZE value. Using default.`);
        }
    }

    let cacheTTL = defaultCacheTTL;
    const cacheTtlEnv = env.CACHE_TTL;
    if (cacheTtlEnv) {
        const parsedTTL = parseInt(cacheTtlEnv, 10);
        if (!isNaN(parsedTTL) && parsedTTL > 0) {
            cacheTTL = parsedTTL;
        } else {
                loggerInstance.warn({ envVar: 'CACHE_TTL', value: cacheTtlEnv, default: defaultCacheTTL }, `Invalid CACHE_TTL value. Using default.`);
        }
    }
    return { max: maxCacheItems, ttl: cacheTTL };
}

// Helper function for parsing tool default max file size (exported for testing)
export function parseToolDefaultMaxFileSize(env: NodeJS.ProcessEnv, loggerInstance: typeof logger): number {
    const defaultMaxFileSize = 1048576; // 1MB
    let toolDefaultMaxFileSize = defaultMaxFileSize;
    const maxFileSizeEnv = env.MAX_FILE_SIZE;
    if (maxFileSizeEnv) {
        const parsedSize = parseInt(maxFileSizeEnv, 10);
        if (!isNaN(parsedSize) && parsedSize > 0) {
            toolDefaultMaxFileSize = parsedSize;
        } else {
            loggerInstance.warn({ envVar: 'MAX_FILE_SIZE', value: maxFileSizeEnv, default: defaultMaxFileSize }, `Invalid MAX_FILE_SIZE value. Using default.`);
        }
    }
    return toolDefaultMaxFileSize;
}
import { TemplateService } from './services/TemplateService.js';
import { CodeAnalysisService } from './services/CodeAnalysisService.js';
import { LRUCache } from 'lru-cache';

interface StreamConfig {
    chunkSize: number;
    useCompression: boolean;
    compressionLevel?: number;
}

interface ChunkInfo {
    totalChunks: number;
    chunkSize: number;
    lastChunkSize: number;
    totalSize: number;
}

interface FileInfo {
    path: string;
    content: string;
    hash: string;
    size: number;
    lastModified: number;
}

interface FilesInfo {
    [path: string]: FileInfo;
}

const DEFAULT_IGNORE_PATTERNS = [
    // Version Control
    '.git/',

    // Python
    '.venv/',
    'venv/',
    '__pycache__/',
    '*.pyc',
    '.pytest_cache/',
    '.coverage',
    'coverage/',
    '*.egg-info/',

    // JavaScript/Node.js
    'node_modules/',
    'bower_components/',
    '.npm/',
    '.yarn/',
    '.pnp.*',
    '.next/',
    '.nuxt/',
    '.output/',
    'dist/',
    'build/',
    '.cache/',
    '*.min.js',
    '*.bundle.js',
    '*.bundle.js.map',

    // IDE/Editor
    '.DS_Store',
    '.idea/',
    '.vscode/',
    '*.swp',
    '*.swo',
    '.env',
    '.env.local',
    '.env.*',
];

const DEFAULT_CONFIG: StreamConfig = {
    chunkSize: 64 * 1024, // 64KB chunks
    useCompression: false,
    compressionLevel: 6
};

class FileContextServer {
    private server: Server;
    private fileWatcherService: FileWatcherService;
    private profileService: ProfileService;
    private templateService: TemplateService;
    private config: StreamConfig;
    private fileContentCache: LRUCache<string, { content: string; lastModified: number }>;
    private codeAnalysisService: CodeAnalysisService;

    public getServer(): Server { // Added public getter for the McpServer instance
        return this.server;
    }

    /**
     * Create standardized file content object
     */
    private async createFileContent(content: string, metadata: FileMetadata, filePath: string, encoding: string = 'utf8'): Promise<FileContent> {
        return {
            content,
            metadata,
            encoding,
            truncated: false,
            totalLines: content.split('\n').length,
            path: filePath
        };
    }

    /**
     * Create standardized JSON response
     */
    private createJsonResponse(data: any): { content: { type: string; text: string }[] } {
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
     * Process file content using streaming when appropriate
     */
    private async processFile(filePath: string, metadata: FileMetadata, encoding: string = 'utf8'): Promise<FileContent> {
        try {
            const { content } = await this.readFileWithEncoding(filePath, encoding);

            return {
                content,
                metadata,
                encoding,
                truncated: false,
                totalLines: content.split('\n').length,
                path: filePath
            };
        } catch (error) {
            throw new FileOperationError(
                FileErrorCode.UNKNOWN_ERROR,
                `Failed to process file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                filePath
            );
        }
    }

    /**
     * Creates a readable stream for file with optional compression
     */
    private createFileStream(filePath: string, useCompression: boolean = false): ReadStream | Gzip {
        const fileStream = createReadStream(filePath, {
            highWaterMark: this.config.chunkSize
        });

        if (useCompression) {
            const gzip = createGzip({
                level: this.config.compressionLevel
            });
            return fileStream.pipe(gzip);
        }

        return fileStream;
    }

    /**
     * Memory-efficient search implementation using streams
     */
    private async streamSearch(
        filePath: string,
        searchPattern: string,
        options: {
            useCompression?: boolean;
            context?: number;
        } = {}
    ): Promise<SearchResult['matches']> {
        const {
            useCompression = this.config.useCompression,
            context = 2
        } = options;

        const matches: SearchResult['matches'] = [];
        const contextLines: string[] = [];
        let lineNumber = 0;

        const processLine = (line: string) => {
            lineNumber++;
            contextLines.push(line);

            if (contextLines.length > context * 2 + 1) {
                contextLines.shift();
            }

            const regex = new RegExp(searchPattern);
            if (regex.test(line)) {
                matches.push({
                    path: filePath,
                    line: lineNumber,
                    content: line,
                    context: {
                        before: contextLines.slice(0, -1),
                        after: []
                    }
                });
            }
        };

        await this.processFileStream(
            filePath,
            async (chunk) => {
                const lines = chunk.toString().split(/\r?\n/);
                lines.forEach(processLine);
            },
            useCompression
        );

        return matches;
    }

    constructor(config: Partial<StreamConfig> = {}) {
        this.fileWatcherService = new FileWatcherService();
        this.profileService = new ProfileService(process.cwd());
        this.templateService = new TemplateService(process.cwd());
        this.config = { ...DEFAULT_CONFIG, ...config };

        const cacheSettings = parseCacheConfig(process.env, logger);
        this.fileContentCache = new LRUCache<string, { content: string; lastModified: number }>({
            max: cacheSettings.max,
            ttl: cacheSettings.ttl
        });
        this.codeAnalysisService = new CodeAnalysisService();

        // Determine default maxSize for tools from environment variable
        const toolDefaultMaxFileSize = parseToolDefaultMaxFileSize(process.env, logger);

        this.server = new Server(
            {
                name: 'file-context-server',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {

                        read_context: {
                            description: 'WARNING: Run get_chunk_count first to determine total chunks, then request specific chunks using chunkNumber parameter.\nRead and analyze code files with advanced filtering and chunking. The server automatically ignores common artifact directories and files:\n- Version Control: .git/\n- Python: .venv/, __pycache__/, *.pyc, etc.\n- JavaScript/Node.js: node_modules/, bower_components/, .next/, dist/, etc.\n- IDE/Editor: .idea/, .vscode/, .env, etc.\n\n**WARNING** use get_chunk_count first to determine total chunks, then request specific chunks using chunkNumber parameter.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    path: {
                                        type: 'string',
                                        description: 'Path to file or directory to read'
                                    },
                                    maxSize: {
                                        type: 'number',
                                        description: 'Maximum file size in bytes. Files larger than this will be chunked.',
                                        default: toolDefaultMaxFileSize
                                    },
                                    encoding: {
                                        type: 'string',
                                        description: 'File encoding (e.g., utf8, ascii, latin1)',
                                        default: 'utf8'
                                    },
                                    recursive: {
                                        type: 'boolean',
                                        description: 'Whether to read directories recursively (includes subdirectories)',
                                        default: true
                                    },
                                    fileTypes: {
                                        type: ['array', 'string'],
                                        items: { type: 'string' },
                                        description: 'File extension(s) to include WITHOUT dots (e.g. ["ts", "js", "py"] or just "ts"). Empty/undefined means all files.',
                                        default: []
                                    },
                                    chunkNumber: {
                                        type: 'number',
                                        description: 'Which chunk to return (0-based). Use with get_chunk_count to handle large files/directories.',
                                        default: 0
                                    }
                                },
                                required: ['path']
                            }
                        },
                        search_context: {
                            description: 'Search for patterns in files with context',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    pattern: {
                                        type: 'string',
                                        description: 'Search pattern (regex supported)'
                                    },
                                    path: {
                                        type: 'string',
                                        description: 'Directory to search in'
                                    },
                                    options: {
                                        type: 'object',
                                        properties: {
                                            recursive: {
                                                type: 'boolean',
                                                default: true
                                            },
                                            includeHidden: {
                                                type: 'boolean',
                                                default: false
                                            },
                                            fileTypes: {
                                                type: 'array',
                                                items: { type: 'string' }
                                            }
                                        }
                                    }
                                },
                                required: ['pattern', 'path']
                            }
                        },
                        get_chunk_count: {
                            description: 'RUN ME ONE TIME BEFORE READING CONTENT\nGet the total number of chunks that will be returned for a read_context request.\nUse this tool FIRST before reading content to determine how many chunks you need to request.\nThe parameters should match what you\'ll use in read_context.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    path: {
                                        type: 'string',
                                        description: 'Path to file or directory'
                                    },
                                    encoding: {
                                        type: 'string',
                                        description: 'File encoding (e.g., utf8, ascii, latin1)',
                                        default: 'utf8'
                                    },
                                    maxSize: {
                                        type: 'number',
                                        description: 'Maximum file size in bytes. Files larger than this will be chunked.',
                                        default: toolDefaultMaxFileSize
                                    },
                                    recursive: {
                                        type: 'boolean',
                                        description: 'Whether to read directories recursively (includes subdirectories)',
                                        default: true
                                    },
                                    fileTypes: {
                                        type: ['array', 'string'],
                                        items: { type: 'string' },
                                        description: 'File extension(s) to include WITHOUT dots (e.g. ["ts", "js", "py"] or just "ts"). Empty/undefined means all files.',
                                        default: []
                                    }
                                },
                                required: ['path']
                            }
                        },
                        set_profile: {
                            description: 'Set the active profile for context generation. Available profiles: code (default), code-prompt (includes LLM instructions), code-file (saves to file)',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    profile_name: {
                                        type: 'string',
                                        description: 'Name of the profile to activate'
                                    }
                                },
                                required: ['profile_name']
                            }
                        },
                        get_profile_context: {
                            description: 'Get repository context based on current profile settings. Includes directory structure, file contents, and code outlines based on profile configuration.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    refresh: {
                                        type: 'boolean',
                                        description: 'Whether to refresh file selection before generating context',
                                        default: false
                                    }
                                }
                            }
                        },
                        generate_outline: {
                            description: 'Generate a code outline for a file, showing its structure (classes, functions, imports, etc). Supports TypeScript/JavaScript and Python files.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    path: {
                                        type: 'string',
                                        description: 'Path to the file to analyze'
                                    }
                                },
                                required: ['path']
                            }
                        }
                    }
                }
            }
        );

        // Error handling
        this.server.onerror = (error) => logger.error({ err: error }, '[MCP Error]');
        process.on('SIGINT', async () => {
            await this.cleanup();
            process.exit(0);
        });

        // Setup file watcher event handlers
        this.fileWatcherService.on('fileChanged', async (filePath) => {
            try {
                const stat = await fs.stat(filePath);
                const content = await fs.readFile(filePath, 'utf8');
                this.fileContentCache.set(filePath, {
                    content,
                    lastModified: stat.mtimeMs
                });
            } catch (error) {
                logger.error({ err: error, filePath }, `Error processing file change for ${filePath}`);
            }
        });
    }

    /**
     * Cleanup resources before shutdown
     */
    private async cleanup(): Promise<void> {
        await this.fileWatcherService.close();
        await this.server.close();
        this.fileContentCache.clear();
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
            logger.error({ err: error, path: resolvedPath }, `Access validation failed for path: ${resolvedPath}`);
            throw new FileOperationError(
                FileErrorCode.INVALID_PATH,
                `Path does not exist or is not accessible: ${resolvedPath}`,
                resolvedPath
            );
        }
    }

    /**
     * Read file with encoding detection and streaming support
     */
    private async readFileWithEncoding(
        filePath: string,
        encoding: string = 'utf8',
        options: {
            useStreaming?: boolean;
            useCompression?: boolean;
        } = {}
    ): Promise<{ content: string, encoding: string }> {
        const stats = await fs.stat(filePath);
        const useStreaming = options.useStreaming ?? (stats.size > 10 * 1024 * 1024);

        if (useStreaming) {
            let content = '';
            await this.processFileStream(
                filePath,
                async (chunk) => {
                    content += chunk.toString(encoding as BufferEncoding);
                },
                options.useCompression
            );
            return { content, encoding };
        }

        // For smaller files, use regular file reading
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

    private async getFileMetadata(filePath: string): Promise<FileMetadata> {
        try {
            const stats = await fs.stat(filePath);
            const ext = path.extname(filePath).slice(1);
            const language = getLanguageFromExtension(ext); // Use imported function

            let analysis = null;
            if (language) {
                const content = await fs.readFile(filePath, 'utf8');
                analysis = await this.codeAnalysisService.analyzeCode(content, language);
            }

            return {
                size: stats.size,
                mimeType: mime.lookup(filePath) || 'application/octet-stream',
                modifiedTime: stats.mtime.toISOString(),
                createdTime: stats.birthtime.toISOString(),
                isDirectory: stats.isDirectory(),
                lastAnalyzed: new Date().toISOString(),
                ...(analysis && {
                    metrics: {
                        linesOfCode: analysis.complexity_metrics.linesOfCode,
                        numberOfFunctions: analysis.complexity_metrics.numberOfFunctions,
                        cyclomaticComplexity: analysis.complexity_metrics.cyclomaticComplexity,
                        maintainabilityIndex: analysis.complexity_metrics.maintainabilityIndex
                    }
                })
            };
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
            // Always resolve to absolute path and convert to POSIX for glob compatibility
            const absolutePath = path.resolve(pattern);
            const globPattern = absolutePath.split(path.sep).join(path.posix.sep);
            logger.debug({ globPattern }, `Glob pattern`);

            // Add .meta to ignore list if not already present
            const ignore = [...(options.ignore || [])];
            if (!ignore.includes('**/*.meta')) {
                ignore.push('**/*.meta');
            }

            const result = await globAsync(globPattern, {
                ...options,
                ignore,
                withFileTypes: false,
                windowsPathsNoEscape: true,
                absolute: true
            });

            const paths = Array.isArray(result) ? result : [result];
            logger.debug({ count: paths.length }, `Glob found paths`);

            // Always return normalized absolute paths for file system operations
            return paths.map(entry => path.normalize(entry.toString()));
        } catch (error) {
            logger.error({ err: error, pattern }, 'Glob error');
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
            // Always resolve and convert to POSIX for glob
            const normalizedDirPath = path.resolve(dirPath);
            const pattern = recursive ? '**/*' : '*';
            const globPattern = path.posix.join(normalizedDirPath.split(path.sep).join(path.posix.sep), pattern);

            logger.debug({ directoryPath: normalizedDirPath, globPattern }, `Listing files`);

            const files = await this.globPromise(globPattern, {
                ignore: includeHidden ? [] : ['.*', '**/.*'],
                nodir: false,
                dot: includeHidden
            });
            logger.debug({ count: files.length }, "Found files for listing");

            for (const file of files) {
                try {
                    // file is already absolute and normalized
                    const fullPath = file;
                    const metadata = await this.getFileMetadata(fullPath);
                    await this.processFile(fullPath, metadata, 'utf8');

                    entries.push({
                        path: fullPath,
                        name: path.basename(fullPath),
                        metadata,
                    });
                } catch (error) {
                    logger.error({ err: error, file }, `Error getting metadata for ${file} in handleListFiles`);
                }
            }

            return this.createJsonResponse({
                entries,
                metadata: {
                    totalFiles: entries.length,
                    searchPath: dirPath,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            throw this.handleFileOperationError(error, 'list files', dirPath);
        }
    }

    /**
     * Calculate chunk information for a file
     */
    private async calculateChunkInfo(filePath: string, chunkSize: number): Promise<ChunkInfo> {
        const stats = await fs.stat(filePath);
        const totalSize = stats.size;
        const totalFullChunks = Math.floor(totalSize / chunkSize);
        const lastChunkSize = totalSize % chunkSize;
        const totalChunks = lastChunkSize > 0 ? totalFullChunks + 1 : totalFullChunks;

        return {
            totalChunks,
            chunkSize,
            lastChunkSize: lastChunkSize || chunkSize,
            totalSize
        };
    }

    /**
     * Read a specific chunk from a file
     */
    private async readFileChunk(filePath: string, chunkNumber: number, chunkSize: number): Promise<Buffer> {
        const { totalChunks, lastChunkSize } = await this.calculateChunkInfo(filePath, chunkSize);

        if (chunkNumber >= totalChunks) {
            throw new FileOperationError(
                FileErrorCode.INVALID_CHUNK,
                `Invalid chunk number ${chunkNumber}. Total chunks: ${totalChunks}`,
                filePath
            );
        }

        const start = chunkNumber * chunkSize;
        const size = chunkNumber === totalChunks - 1 ? lastChunkSize : chunkSize;

        const fileHandle = await fs.open(filePath, 'r');
        try {
            const buffer = Buffer.alloc(size);
            await fileHandle.read(buffer, 0, size, start);
            return buffer;
        } finally {
            await fileHandle.close();
        }
    }

    private async handleReadFile(args: any) {
        const {
            path: filePath,
            encoding = 'utf8',
            maxSize,
            recursive = true,
            fileTypes,
            chunkNumber = 0
        } = args;

        try {
            const filesInfo = await this.readContent(filePath, encoding as BufferEncoding, maxSize, recursive, fileTypes);
            const { content, hasMore } = this.getContentChunk(filesInfo, chunkNumber * this.config.chunkSize);

            return this.createJsonResponse({
                content,
                hasMore,
                nextChunk: hasMore ? chunkNumber + 1 : null
            });
        } catch (error) {
            throw this.handleFileOperationError(error, 'read file', filePath);
        }
    }

    private async handleGetChunkCount(args: any) {
        const {
            path: filePath,
            encoding = 'utf8',
            maxSize,
            recursive = true,
            fileTypes
        } = args;

        try {
            const filesInfo = await this.readContent(filePath, encoding as BufferEncoding, maxSize, recursive, fileTypes);
            const totalChunks = this.getTotalChunks(filesInfo);

            return this.createJsonResponse({
                totalChunks,
                chunkSize: this.config.chunkSize
            });
        } catch (error) {
            throw this.handleFileOperationError(error, 'get chunk count', filePath);
        }
    }

    /**
     * Read content from files with filtering
     */
    private async readContent(
        filePath: string,
        encoding: BufferEncoding = 'utf8',
        maxSize?: number,
        recursive: boolean = true,
        fileTypes?: string[] | string
    ): Promise<FilesInfo> {
        const filesInfo: FilesInfo = {};
        const absolutePath = path.resolve(filePath);
        const cleanFileTypes = Array.isArray(fileTypes)
            ? fileTypes.map(ext => ext.toLowerCase().replace(/^\./, ''))
            : fileTypes
                ? [fileTypes.toLowerCase().replace(/^\./, '')]
                : undefined;

        logger.debug({ fileTypes: cleanFileTypes, path: filePath }, '[FileContextServer] Reading content');

        // Handle single file
        if ((await fs.stat(absolutePath)).isFile()) {
            if (cleanFileTypes && !cleanFileTypes.some(ext => absolutePath.toLowerCase().endsWith(`.${ext}`))) {
                return filesInfo;
            }

            const stat = await fs.stat(absolutePath);
            if (maxSize && stat.size > maxSize) {
                throw new FileOperationError(
                    FileErrorCode.FILE_TOO_LARGE,
                    `File ${absolutePath} exceeds maximum size limit of ${maxSize} bytes`,
                    absolutePath
                );
            }

            // Check cache first
            const cached = this.fileContentCache.get(absolutePath);
            let content: string;
            if (cached && cached.lastModified === stat.mtimeMs) {
                content = cached.content;
            } else {
                content = await fs.readFile(absolutePath, encoding);
                this.fileContentCache.set(absolutePath, {
                    content,
                    lastModified: stat.mtimeMs
                });
            }

            const hash = createHash('md5').update(content).digest('hex');
            filesInfo[absolutePath] = {
                path: absolutePath,
                content,
                hash,
                size: stat.size,
                lastModified: stat.mtimeMs
            };

            return filesInfo;
        }

        // Handle directory: use POSIX join for glob
        const pattern = recursive ? '**/*' : '*';
        const globPattern = path.posix.join(absolutePath.split(path.sep).join(path.posix.sep), pattern);

        const files = await this.globPromise(globPattern, {
            ignore: DEFAULT_IGNORE_PATTERNS,
            nodir: true,
            dot: false,
            cache: true,
            follow: false
        });

        await Promise.all(files.map(async (file) => {
            if (cleanFileTypes && !cleanFileTypes.some(ext => file.toLowerCase().endsWith(`.${ext}`))) {
                return;
            }

            try {
                const stat = await fs.stat(file);
                if (maxSize && stat.size > maxSize) {
                    return;
                }

                // Check cache first
                const cached = this.fileContentCache.get(file);
                let content: string;
                if (cached && cached.lastModified === stat.mtimeMs) {
                    content = cached.content;
                } else {
                    content = await fs.readFile(file, encoding);
                    this.fileContentCache.set(file, {
                        content,
                        lastModified: stat.mtimeMs
                    });
                }

                const hash = createHash('md5').update(content).digest('hex');
                filesInfo[file] = {
                    path: file,
                    content,
                    hash,
                    size: stat.size,
                    lastModified: stat.mtimeMs
                };
            } catch (error) {
                logger.error({ err: error, file }, `Error reading file ${file} in readContent`);
            }
        }));

        return filesInfo;
    }

    /**
     * Get content chunk from files info
     */
    private getContentChunk(filesInfo: FilesInfo, startChunk: number = 0): { content: string; hasMore: boolean } {
        const allContent: string[] = [];

        for (const fileInfo of Object.values(filesInfo)) {
            allContent.push(`File: ${fileInfo.path}\n${fileInfo.content}\n`);
        }

        const combinedContent = allContent.join('');
        const chunk = combinedContent.slice(startChunk, startChunk + this.config.chunkSize);
        const hasMore = combinedContent.length > startChunk + this.config.chunkSize;

        return { content: chunk, hasMore };
    }

    /**
     * Calculate total chunks for files
     */
    private getTotalChunks(filesInfo: FilesInfo): number {
        let totalContentLength = 0;

        for (const fileInfo of Object.values(filesInfo)) {
            totalContentLength += `File: ${fileInfo.path}\n${fileInfo.content}\n`.length;
        }

        return Math.ceil(totalContentLength / this.config.chunkSize);
    }

    private async processFileStream(
        filePath: string,
        processChunk: (chunk: Buffer) => Promise<void>,
        useCompression: boolean = false
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const fileStream = this.createFileStream(filePath, useCompression);

            const processStream = new Transform({
                transform: async function (chunk: Buffer, encoding: string, callback) {
                    try {
                        await processChunk(chunk);
                        callback();
                    } catch (error) {
                        callback(error as Error);
                    }
                }
            });

            pipeline(fileStream, processStream, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    private async handleSearchFiles(request: any) {
        const { pattern: searchPattern, path: searchPath, options = {} } = request.params.arguments;
        const { recursive = true, includeHidden = false, fileTypes = [] } = options;

        try {
            await this.validateAccess(searchPath);

            const matches: SearchResult['matches'] = [];
            let totalMatches = 0;

            // Always resolve and convert to POSIX for glob
            const normalizedSearchPath = path.resolve(searchPath);
            const pattern = recursive ? '**/*' : '*';
            const globPattern = path.posix.join(normalizedSearchPath.split(path.sep).join(path.posix.sep), pattern);

            const files = await this.globPromise(globPattern, {
                ignore: includeHidden ? [] : ['.*', '**/.*'],
                nodir: true,
                dot: includeHidden
            });

            for (const file of files) {
                if (fileTypes.length > 0) {
                    const ext = path.extname(file).slice(1);
                    if (!fileTypes.includes(ext)) continue;
                }

                const fileMatches = await this.streamSearch(file, searchPattern, {
                    useCompression: this.config.useCompression,
                    context: 2
                });

                matches.push(...fileMatches);
                totalMatches += fileMatches.length;
            }

            return this.createJsonResponse({
                matches,
                totalMatches,
                metadata: {
                    searchPath,
                    pattern: searchPattern,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            throw this.handleFileOperationError(error, 'search files', searchPath);
        }
    }

    private async handleSetProfile(args: any) {
        const { profile_name } = args;
        logger.info({ profileName: profile_name }, `[FileContextServer] Setting profile`);
        try {
            await this.profileService.setProfile(profile_name);
            const response = {
                message: `Successfully switched to profile: ${profile_name}`,
                timestamp: Date.now()
            };
            logger.info({ response }, '[FileContextServer] Profile set successfully');
            return this.createJsonResponse(response);
        } catch (error) {
            logger.error({ err: error, profileName: profile_name }, '[FileContextServer] Failed to set profile');
            throw new McpError(
                ErrorCode.InvalidParams,
                `Failed to set profile: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    private async handleGetProfileContext(args: any) {
        try {
            const { refresh = false } = args;
            const spec = await this.profileService.getActiveProfile();
            const state = this.profileService.getState();

            if (refresh || !state.full_files) {
                await this.profileService.selectFiles();
            }

            // Read full content files
            const files = await Promise.all(state.full_files.map(async (path) => {
                try {
                    const metadata = await this.getFileMetadata(path);
                    const content = await this.processFile(path, metadata);
                    const analysis = await this.codeAnalysisService.analyzeCode(content.content, path);
                    return {
                        ...content,
                        analysis: {
                            metrics: analysis.metrics,
                            complexity: analysis.complexity_metrics.cyclomaticComplexity,
                            maintainability: analysis.complexity_metrics.maintainabilityIndex,
                            quality_issues: analysis.metrics.quality.longLines + analysis.metrics.quality.duplicateLines + analysis.metrics.quality.complexFunctions
                        }
                    };
                } catch (error) {
                    logger.error({ err: error, filePath: path }, `Error processing file in handleGetProfileContext (full content)`);
                    return null;
                }
            })).then(results => results.filter((f): f is NonNullable<typeof f> => f !== null));

            // Generate outlines for selected files
            const outlines = await Promise.all(state.outline_files.map(async (path) => {
                try {
                    const metadata = await this.getFileMetadata(path);
                    const content = await this.processFile(path, metadata);
                    const analysis = await this.codeAnalysisService.analyzeCode(content.content, path);
                    return {
                        path,
                        outline: analysis.outline,
                        metadata,
                        analysis: {
                            metrics: analysis.metrics,
                            complexity: analysis.complexity_metrics.cyclomaticComplexity,
                            maintainability: analysis.complexity_metrics.maintainabilityIndex
                        }
                    };
                } catch (error) {
                    logger.error({ err: error, filePath: path }, `Error generating outline in handleGetProfileContext`);
                    return null;
                }
            })).then(results => results.filter((o): o is NonNullable<typeof o> => o !== null));

            const structure = await this.generateStructure(spec.profile.settings.no_media);

            // Get prompt if profile specifies it
            let prompt = '';
            if (spec.profile.prompt) {
                prompt = await this.templateService.getPrompt();
            }

            // Enhanced context with LLM-friendly metadata
            const context = {
                project_name: path.basename(process.cwd()),
                project_root: process.cwd(),
                timestamp: new Date(state.timestamp).toISOString(),
                profile: {
                    name: spec.profile.name,
                    description: spec.profile.description || 'Default profile settings',
                    settings: spec.profile.settings
                },
                stats: {
                    total_files: files.length + outlines.length,
                    full_content_files: files.length,
                    outline_files: outlines.length,
                    excluded_files: state.excluded_files?.length || 0,
                    code_metrics: {
                        total_lines: files.reduce((sum, f) => sum + f.analysis.metrics.lineCount.total, 0),
                        code_lines: files.reduce((sum, f) => sum + f.analysis.metrics.lineCount.code, 0),
                        comment_lines: files.reduce((sum, f) => sum + f.analysis.metrics.lineCount.comment, 0),
                        average_complexity: files.length > 0 ? files.reduce((sum, f) => sum + f.analysis.complexity, 0) / files.length : 0,
                        quality_issues: files.reduce((sum, f) => sum + f.analysis.quality_issues, 0)
                    }
                },
                prompt,
                files: files.map(f => ({
                    ...f,
                    language: path.extname(f.path).slice(1) || 'text',
                    metadata: {
                        ...f.metadata,
                        relative_path: path.relative(process.cwd(), f.path),
                        file_type: getFileType(f.path), // Use imported function
                        last_modified_relative: this.getRelativeTime(new Date(f.metadata.modifiedTime)),
                        analysis: f.analysis
                    }
                })),
                highlights: outlines.map(o => ({
                    ...o,
                    metadata: {
                        ...o.metadata,
                        relative_path: path.relative(process.cwd(), o.path),
                        file_type: getFileType(o.path), // Use imported function
                        last_modified_relative: this.getRelativeTime(new Date(o.metadata.modifiedTime)),
                        analysis: o.analysis
                    }
                })),
                folder_structure_diagram: structure,
                tools: {
                    file_access: {
                        name: 'lc-get-files',
                        description: 'Retrieve specific file contents',
                        example: { path: process.cwd(), files: ['example/path/file.ts'] }
                    },
                    search: {
                        name: 'search_context',
                        description: 'Search for patterns in files',
                        example: { pattern: 'searchTerm', path: process.cwd() }
                    },
                    changes: {
                        name: 'lc-list-modified-files',
                        description: 'Track file changes since context generation',
                        example: { timestamp: state.timestamp }
                    }
                }
            };

            return this.createJsonResponse(context);
        } catch (error) {
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get profile context: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    // `getRelativeTime` might be specific enough to this class or could be a general date utility.
    // For now, it remains here. If other utils need it, it can be moved.
    private getRelativeTime(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSecs = Math.round(diffMs / 1000);
        const diffMins = Math.round(diffSecs / 60);
        const diffHours = Math.round(diffMins / 60);
        const diffDays = Math.round(diffHours / 24);

        if (diffSecs < 60) return `${diffSecs} seconds ago`;
        if (diffMins < 60) return `${diffMins} minutes ago`;
        if (diffHours < 24) return `${diffHours} hours ago`;
        if (diffDays < 30) return `${diffDays} days ago`;

        return date.toLocaleDateString();
    }

    private async getFilteredFiles(ignorePatterns: string[], includePatterns: string[]): Promise<string[]> {
        const allFiles: string[] = [];
        for (const pattern of includePatterns) {
            const files = await globAsync(pattern, {
                ignore: ignorePatterns,
                nodir: true,
                dot: true
            });
            allFiles.push(...files);
        }
        return [...new Set(allFiles)];
    }

    private async readFiles(paths: string[]): Promise<FileContent[]> {
        const files: FileContent[] = [];
        for (const path of paths) {
            try {
                const metadata = await this.getFileMetadata(path);
                const content = await this.processFile(path, metadata);
                files.push(content);
            } catch (error) {
                logger.error({ err: error, filePath: path }, `Error reading file in readFiles utility`);
            }
        }
        return files;
    }

    private async generateOutlines(paths: string[]): Promise<FileOutline[]> {
        const outlines: FileOutline[] = [];
        for (const path of paths) {
            try {
                const metadata = await this.getFileMetadata(path);
                const content = await this.processFile(path, metadata);
                const analysis = await this.codeAnalysisService.analyzeCode(content.content, path);
                outlines.push({
                    path,
                    outline: this.formatAnalysisOutline(path, analysis),
                    metadata
                });
            } catch (error) {
                logger.error({ err: error, filePath: path }, `Error generating outline in generateOutlines utility`);
            }
        }
        return outlines;
    }

    private formatAnalysisOutline(filePath: string, analysis: any): string {
        const parts: string[] = [];
        parts.push(`File: ${path.basename(filePath)}`);

        if (analysis.imports?.length) {
            parts.push('\nImports:');
            parts.push(analysis.imports.map((imp: string) => `  - ${imp}`).join('\n'));
        }

        if (analysis.definitions?.length) {
            parts.push('\nDefinitions:');
            parts.push(analysis.definitions.map((def: string) => `  - ${def}`).join('\n'));
        }

        if (analysis.complexity) {
            parts.push(`\nComplexity: ${analysis.complexity}`);
        }

        return parts.join('\n');
    }

    private getLanguageFromExtension(ext: string): string | null {
        const extensionMap: Record<string, string> = {
            'py': 'python',
            'ts': 'typescript',
            'tsx': 'typescript',
            'js': 'javascript',
            'jsx': 'javascript',
            'cs': 'csharp',
            'go': 'go',
            'sh': 'bash',
            'bash': 'bash'
        };
        return extensionMap[ext] || null;
    }

    private async generateStructure(noMedia: boolean = false): Promise<string> {
        const state = this.profileService.getState();
        const files = [...new Set([...state.full_files, ...state.outline_files])];

        const filteredFiles = noMedia
            ? files.filter(file => isMediaFile(file))
            : files;

        return filteredFiles.map(file => {
            const prefix = state.full_files.includes(file) ? '✓' : '○';
            return `${prefix} ${file}`;
        }).join('\n');
    }

    private isMediaFile(filePath: string): boolean {
        const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.mp4', '.avi', '.mov'];
        return mediaExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
    }

    private async handleGenerateOutline(args: any) {
        const { path: filePath } = args;
        logger.info({ filePath }, `[FileContextServer] Generating outline for`);

        try {
            await this.validateAccess(filePath);
            const outline = `File: ${path.basename(filePath)}
Type: ${path.extname(filePath) || 'unknown'}
Path: ${filePath}`;

            return this.createJsonResponse({
                path: filePath,
                outline,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            throw this.handleFileOperationError(error, 'generate outline', filePath);
        }
    }

    async run() {
        logger.info('[FileContextServer] Starting server');
        // Initialize services
        await this.profileService.initialize();
        await this.templateService.initialize();
        logger.info('[FileContextServer] Services initialized');

        // Determine default maxSize for tools from environment variable for ListToolsRequestSchema
        // This is duplicated because ListToolsRequestSchema might be called before the server instance's tool defs are fully processed
        // Ideally, the SDK would allow dynamic tool schema updates or a single source for these defaults.
        // For testing purposes, we'll call the same parsing function. In a real scenario, this might share a module-level const.
        const toolDefaultMaxFileSizeForListTools = parseToolDefaultMaxFileSize(process.env, logger);

        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [

                {
                    name: 'read_context',
                    description: 'Read and analyze code files with advanced filtering and chunking. The server automatically ignores common artifact directories and files:\n- Version Control: .git/\n- Python: .venv/, __pycache__/, *.pyc, etc.\n- JavaScript/Node.js: node_modules/, bower_components/, .next/, dist/, etc.\n- IDE/Editor: .idea/, .vscode/, .env, etc.\n\nFor large files or directories, use get_chunk_count first to determine total chunks, then request specific chunks using chunkNumber parameter.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Path to file or directory to read'
                            },
                            maxSize: {
                                type: 'number',
                                description: 'Maximum file size in bytes. Files larger than this will be chunked.',
                                default: toolDefaultMaxFileSizeForListTools
                            },
                            encoding: {
                                type: 'string',
                                description: 'File encoding (e.g., utf8, ascii, latin1)',
                                default: 'utf8'
                            },
                            recursive: {
                                type: 'boolean',
                                description: 'Whether to read directories recursively (includes subdirectories)',
                                default: true
                            },
                            fileTypes: {
                                type: ['array', 'string'],
                                items: { type: 'string' },
                                description: 'File extension(s) to include WITHOUT dots (e.g. ["ts", "js", "py"] or just "ts"). Empty/undefined means all files.',
                                default: []
                            },
                            chunkNumber: {
                                type: 'number',
                                description: 'Which chunk to return (0-based). Use with get_chunk_count to handle large files/directories.',
                                default: 0
                            }
                        },
                        required: ['path']
                    }
                },
                {
                    name: 'get_chunk_count',
                    description: 'Get the total number of chunks that will be returned for a read_context request.\nUse this tool FIRST before reading content to determine how many chunks you need to request.\nThe parameters should match what you\'ll use in read_context.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Path to file or directory'
                            },
                            encoding: {
                                type: 'string',
                                description: 'File encoding (e.g., utf8, ascii, latin1)',
                                default: 'utf8'
                            },
                            maxSize: {
                                type: 'number',
                                description: 'Maximum file size in bytes. Files larger than this will be chunked.',
                                default: toolDefaultMaxFileSizeForListTools
                            },
                            recursive: {
                                type: 'boolean',
                                description: 'Whether to read directories recursively (includes subdirectories)',
                                default: true
                            },
                            fileTypes: {
                                type: ['array', 'string'],
                                items: { type: 'string' },
                                description: 'File extension(s) to include WITHOUT dots (e.g. ["ts", "js", "py"] or just "ts"). Empty/undefined means all files.',
                                default: []
                            }
                        },
                        required: ['path']
                    }
                },
                {
                    name: 'set_profile',
                    description: 'Set the active profile for context generation',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            profile_name: {
                                type: 'string',
                                description: 'Name of the profile to activate'
                            }
                        },
                        required: ['profile_name']
                    }
                },
                {
                    name: 'get_profile_context',
                    description: 'Get repository context based on current profile settings',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            refresh: {
                                type: 'boolean',
                                description: 'Whether to refresh file selection before generating context',
                                default: false
                            }
                        }
                    }
                },
                {
                    name: 'generate_outline',
                    description: 'Generate a code outline for a file, showing its structure (classes, functions, imports, etc). Supports TypeScript/JavaScript and Python files.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Path to the file to analyze'
                            }
                        },
                        required: ['path']
                    }
                }
            ]
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                if (!request.params.arguments) {
                    throw new McpError(ErrorCode.InvalidParams, 'Missing arguments');
                }

                switch (request.params.name) {
                    case 'list_context_files':
                        return await this.handleListFiles(request.params.arguments);
                    case 'read_context':
                        return await this.handleReadFile(request.params.arguments);
                    case 'search_context':
                        return await this.handleSearchFiles(request);
                    case 'get_chunk_count':
                        return await this.handleGetChunkCount(request.params.arguments);
                    case 'set_profile':
                        return await this.handleSetProfile(request.params.arguments);
                    case 'get_profile_context':
                        return await this.handleGetProfileContext(request.params.arguments);
                    case 'generate_outline':
                        return await this.handleGenerateOutline(request.params.arguments);
                    default:
                        throw new McpError(
                            ErrorCode.MethodNotFound,
                            `Unknown tool: ${request.params.name}`
                        );
                }
            } catch (error) {
                if (error instanceof FileOperationError) {
                    return {
                        content: [{
                            type: 'text',
                            text: `File operation error: ${error.message} (${error.code})`
                        }],
                        isError: true
                    };
                }
                throw error;
            }
        });

        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        logger.info('File Context MCP server running on stdio');
    }
}

// Start the server (for Stdio transport by default)
export const fileContextServerInstance = new FileContextServer();

// Only run the Stdio server if this file is executed directly (not imported for HTTP server)
if (require.main === module) {
    fileContextServerInstance.run().catch(err => {
        logger.fatal({ err }, 'Failed to run Stdio server');
        process.exit(1);
    });
}

