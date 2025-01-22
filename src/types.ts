export interface FileMetadata {
    size: number;
    mimeType: string;
    modifiedTime: string;
    createdTime: string;
    isDirectory: boolean;
    analysis?: CodeAnalysis;
    lastAnalyzed?: string;
}

export interface FileContent {
    content: string;
    metadata: FileMetadata;
    encoding: string;
    truncated: boolean;
    totalLines: number;
    path: string;
}

export interface CodeAnalysis {
    definitions?: string[];
    imports?: string[];
    complexity?: number;
}

export interface CacheEntry {
    content: FileContent;
    lastModified: number;
    lastAccessed: Date;
}

export interface EnhancedCacheEntry extends CacheEntry {
    size: number;
    hits: number;
}

export interface FileEntry {
    path: string;
    name: string;
    metadata: FileMetadata;
}

export enum FileErrorCode {
    INVALID_PATH = 'INVALID_PATH',
    FILE_NOT_FOUND = 'FILE_NOT_FOUND',
    FILE_TOO_LARGE = 'FILE_TOO_LARGE',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
    INVALID_CHUNK = 'INVALID_CHUNK'
}

export class FileOperationError extends Error {
    constructor(
        public code: FileErrorCode,
        message: string,
        public path: string
    ) {
        super(message);
        this.name = 'FileOperationError';
    }
}

export interface SearchOptions {
    recursive?: boolean;
    includeHidden?: boolean;
    fileTypes?: string[];
}

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
}

export interface DirectoryContent {
    files: Record<string, FileContent>;
    totalSize: number;
    totalFiles: number;
}

export interface EnhancedSearchOptions extends SearchOptions {
    maxResults?: number;
    contextLines?: number;
    ignoreCase?: boolean;
}

export interface ChunkMetadata {
    id: string;
    path: string;
    startOffset: number;
    endOffset: number;
    type: 'code' | 'text' | 'markdown';
    relevanceScore: number;
    semanticContext?: string;
}

export interface CompressedChunk {
    id: string;
    compressedData: Buffer;
    originalSize: number;
    compressionRatio: number;
}

export interface ContentChunk {
    metadata: ChunkMetadata;
    content: string | CompressedChunk;
    lastAccessed: number;
    accessCount: number;
}

export interface ChunkingStrategy {
    maxChunkSize: number;
    minChunkSize: number;
    preferredBoundaries: RegExp[];
    compressionThreshold: number;
}

export interface MemoryPressureEvent {
    timestamp: number;
    currentUsage: number;
    threshold: number;
    availableMemory: number;
}

export interface CacheStats {
    totalSize: number;
    chunkCount: number;
    compressionRatio: number;
    hitRate: number;
    evictionCount: number;
}
