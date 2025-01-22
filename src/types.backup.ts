// Using string literal type for encoding since BufferEncoding isn't directly accessible
export type FileEncoding = 'utf8' | 'utf-8' | 'ascii' | 'binary' | 'base64' | 'hex' | 'latin1';

/**
 * Code analysis result containing metrics, relationships and quality indicators
 */
export interface CodeAnalysis {
    metrics: {
        lines: number;
        nonEmptyLines: number;
        commentLines: number;
        complexity: number;
    };
    dependencies: string[];
    quality: {
        duplicateLines: number;
        longLines: number;
        complexFunctions: number;
    };
}

/**
 * Function metadata from code analysis
 */
export interface FunctionMetadata {
    name: string;
    startLine: number;
    endLine: number;
    parameters: string[];
    returnType?: string;
    complexity: number;
    dependencies: string[];
}

/**
 * Class metadata from code analysis
 */
export interface ClassMetadata {
    name: string;
    startLine: number;
    endLine: number;
    methods: FunctionMetadata[];
    properties: PropertyMetadata[];
    extends?: string;
    implements?: string[];
}

/**
 * Property metadata for classes
 */
export interface PropertyMetadata {
    name: string;
    type?: string;
    visibility: 'public' | 'private' | 'protected';
    static: boolean;
}

/**
 * Import statement metadata
 */
export interface ImportMetadata {
    source: string;
    specifiers: string[];
    line: number;
}

/**
 * Cache entry for file contents and analysis
 */
export interface CacheEntry {
    content: FileContent;
    analysis?: CodeAnalysis;
    lastModified: number;
    hits: number;
    lastAccessed: Date;
    size: number;
}

export interface CacheStats {
    size: number;
    maxSize: number;
    itemCount: number;
    hitRate: number;
    missRate: number;
}

/**
 * Cache entry content with metadata
 */
export interface CachedContent {
    files: { [path: string]: FileContent };
    metadata: {
        totalFiles: number;
        totalSize: number;
        truncated: boolean;
        searchPath: string;
        fileTypes: string[] | string | undefined;
        timestamp: string;
    };
}

/**
 * Extended FileContent to include CachedContent
 */
export interface ExtendedFileContent extends FileContent {
    content: string | CachedContent;
}

/**
 * Cache entry with extended content
 */
export interface ExtendedCacheEntry {
    content: ExtendedFileContent;
    analysis?: CodeAnalysis;
    lastModified: number;
}

/**
 * Enhanced search options with semantic capabilities
 */
export interface EnhancedSearchOptions extends SearchOptions {
    semantic?: boolean;
    contextLines?: number;
    multiplePatterns?: string[];
    excludePatterns?: string[];
    languageFilter?: string[];
}

/**
 * Represents file metadata including size, type, modification time and analysis
 */
export interface FileMetadata {
    size: number;
    mimeType: string;
    modifiedTime: string;
    createdTime: string;
    isDirectory: boolean;
    analysis?: CodeAnalysis;
    lastAnalyzed?: string;
}

/**
 * Represents a file or directory entry with its metadata
 */
export interface FileEntry {
    path: string;
    name: string;
    metadata: FileMetadata;
}

/**
 * Options for file search operations
 */
export interface SearchOptions {
    recursive?: boolean;
    includeHidden?: boolean;
    maxDepth?: number;
    fileTypes?: string[];
}

/**
 * Options for reading file contents
 */
export interface ReadOptions {
    encoding?: FileEncoding;
    maxSize?: number;
    startLine?: number;
    endLine?: number;
}

/**
 * Result of a file search operation
 */
export interface SearchResult {
    matches: Array<{
        path: string;
        line: number;
        content: string;
        context: {
            before: string[];
            after: string[];
        };
    }>;
    totalMatches: number;
}

/**
 * File content with metadata
 */
export interface FileContent {
    content: string | CachedContent;
    metadata: FileMetadata;
    encoding: string;
    truncated: boolean;
    totalLines?: number;
}

/**
 * Multiple file contents with metadata
 */
export interface DirectoryContent {
    files: {
        [path: string]: FileContent;
    };
    metadata: {
        totalFiles: number;
        totalSize: number;
        truncated: boolean;
    };
}

/**
 * Directory listing result
 */
export interface DirectoryListing {
    entries: FileEntry[];
    path: string;
    totalCount: number;
    hasMore: boolean;
}

/**
 * Error codes specific to file operations
 */
export enum FileErrorCode {
    FILE_NOT_FOUND = 'FILE_NOT_FOUND',
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    INVALID_PATH = 'INVALID_PATH',
    FILE_TOO_LARGE = 'FILE_TOO_LARGE',
    ENCODING_ERROR = 'ENCODING_ERROR',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Custom error class for file operations
 */
export class FileOperationError extends Error {
    constructor(
        public code: FileErrorCode,
        message: string,
        public path?: string
    ) {
        super(message);
        this.name = 'FileOperationError';
    }
}
