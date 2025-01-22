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
import { createReadStream, ReadStream } from 'fs';
import { createGzip, Gzip } from 'zlib';
import { pipeline, Transform } from 'stream';
import { promisify } from 'util';
import { glob as globCb } from 'glob';
import type { IOptions } from 'glob';
import globPkg from 'glob';
import * as path from 'path';
import * as mime from 'mime-types';
import * as os from 'os';
import { FileMetadata } from './types.js';
import { FileWatcherService } from './services/FileWatcherService.js';
import { createHash } from 'crypto';

// Configuration interface
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

const DEFAULT_CONFIG: StreamConfig = {
    chunkSize: 64 * 1024, // 64KB chunks
    useCompression: false,
    compressionLevel: 6
};

const glob = promisify(globPkg) as (pattern: string, options?: IOptions) => Promise<string[]>;

import {
    FileContent,
    FileEntry,
    FileErrorCode,
    FileOperationError,
    SearchOptions,
    SearchResult,
    DirectoryContent,
    EnhancedSearchOptions
} from './types.js';

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

class FileContextServer {
    private server: Server;
    private fileWatcherService: FileWatcherService;
    private config: StreamConfig;
    private fileContentCache: Map<string, { content: string; lastModified: number }>;

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
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.fileContentCache = new Map();

        this.server = new Server(
            {
                name: 'file-context-server',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {
                        list_context_files: {
                            description: 'List files in a directory with detailed metadata. Automatically ignores common artifact directories and files like node_modules, .git, etc. Returns file metadata including size, mime type, and modification times.',
                            inputSchema: {
                                type: 'object',
                                properties: {
                                    path: {
                                        type: 'string',
                                        description: 'Directory path to list files from'
                                    },
                                    recursive: {
                                        type: 'boolean',
                                        description: 'Whether to list files recursively (includes subdirectories)',
                                        default: false
                                    },
                                    includeHidden: {
                                        type: 'boolean',
                                        description: 'Whether to include hidden files (starting with .)',
                                        default: false
                                    }
                                },
                                required: ['path']
                            }
                        },
                        read_context: {
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
                                        default: 1048576
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
                                        type: 'array',
                                        items: { type: 'string' },
                                        description: 'List of file extensions to include WITHOUT dots (e.g. ["ts", "js", "py"]). Empty array means all files.',
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
                                        default: 1048576
                                    },
                                    recursive: {
                                        type: 'boolean',
                                        description: 'Whether to read directories recursively (includes subdirectories)',
                                        default: true
                                    },
                                    fileTypes: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        description: 'List of file extensions to include WITHOUT dots (e.g. ["ts", "js", "py"]). Empty array means all files.',
                                        default: []
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
        this.server.onerror = (error) => console.error('[MCP Error]', error);
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
                console.error(`Error processing file change for ${filePath}:`, error);
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
            console.error(`Access validation failed for path: ${resolvedPath}`, error);
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
            return {
                size: stats.size,
                mimeType: mime.lookup(filePath) || 'application/octet-stream',
                modifiedTime: stats.mtime.toISOString(),
                createdTime: stats.birthtime.toISOString(),
                isDirectory: stats.isDirectory()
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
                    const metadata = await this.getFileMetadata(fullPath);
                    const fileContent = await this.processFile(fullPath, metadata, 'utf8');

                    entries.push({
                        path: fullPath,
                        name: path.basename(fullPath),
                        metadata,
                    });
                } catch (error) {
                    console.error(`Error getting metadata for ${file}: ${error}`);
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
        fileTypes?: string[]
    ): Promise<FilesInfo> {
        const filesInfo: FilesInfo = {};
        const absolutePath = path.resolve(filePath);
        const cleanFileTypes = fileTypes?.map(ext => ext.toLowerCase().replace(/^\./, ''));

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

        // Handle directory
        const pattern = recursive ? '**/*' : '*';
        const globPattern = path.join(absolutePath, pattern);

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
                console.error(`Error reading ${file}:`, error);
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

            const pattern = recursive ? '**/*' : '*';
            const globPattern = path.join(searchPath, pattern);

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

    async run() {
        // Set up request handlers
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'list_context_files',
                    description: 'List files in a directory with detailed metadata. Automatically ignores common artifact directories and files like node_modules, .git, etc. Returns file metadata including size, mime type, and modification times.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: {
                                type: 'string',
                                description: 'Directory path to list files from'
                            },
                            recursive: {
                                type: 'boolean',
                                description: 'Whether to list files recursively (includes subdirectories)',
                                default: false
                            },
                            includeHidden: {
                                type: 'boolean',
                                description: 'Whether to include hidden files (starting with .)',
                                default: false
                            }
                        },
                        required: ['path']
                    }
                },
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
                                default: 1048576
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
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of file extensions to include WITHOUT dots (e.g. ["ts", "js", "py"]). Empty array means all files.',
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
                                default: 1048576
                            },
                            recursive: {
                                type: 'boolean',
                                description: 'Whether to read directories recursively (includes subdirectories)',
                                default: true
                            },
                            fileTypes: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'List of file extensions to include WITHOUT dots (e.g. ["ts", "js", "py"]). Empty array means all files.',
                                default: []
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
        console.error('File Context MCP server running on stdio');
    }
}

// Start the server
const server = new FileContextServer();
server.run().catch(console.error);

