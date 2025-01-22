export interface FileMetadata {
    size: number;
    mimeType: string;
    modifiedTime: string;
    createdTime: string;
    isDirectory: boolean;
}

export interface FileContent {
    content: string;
    metadata: FileMetadata;
    encoding: string;
    truncated: boolean;
    totalLines: number;
}

export interface DirectoryContent {
    files: { [path: string]: FileContent };
    metadata: {
        totalFiles: number;
        totalSize: number;
        truncated: boolean;
        searchPath: string;
        fileTypes?: string[];
        timestamp: string;
    };
}

export interface FileEntry {
    path: string;
    name: string;
    metadata: FileMetadata;
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
    totalMatches: number;
}

export interface SearchOptions {
    recursive?: boolean;
    includeHidden?: boolean;
    contextLines?: number;
    fileTypes?: string[];
    excludePatterns?: string[];
}

export enum FileErrorCode {
    FILE_NOT_FOUND = 'FILE_NOT_FOUND',
    INVALID_PATH = 'INVALID_PATH',
    FILE_TOO_LARGE = 'FILE_TOO_LARGE',
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR'
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

export interface TaskResult<T = any> {
    success: boolean;
    data?: T;
    error?: Error;
    duration: number;
}

export interface ProcessFileResult {
    lines: number;
    size: number;
    truncated: boolean;
}

export interface FileProcessingResult {
    content: FileContent;
    error?: Error;
} 