import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';
import * as path from 'path';
import { CacheService } from './CacheService.js';

/**
 * Service for monitoring file system changes and managing cache invalidation
 */
export class FileWatcherService extends EventEmitter {
    private watcher: chokidar.FSWatcher | null = null;
    private watchedPaths: Set<string> = new Set();

    constructor(private cacheService: CacheService) {
        super();
    }

    /**
     * Start watching a directory or file
     */
    public async watch(targetPath: string): Promise<void> {
        if (this.watchedPaths.has(targetPath)) {
            return;
        }

        if (!this.watcher) {
            this.watcher = chokidar.watch(targetPath, {
                persistent: true,
                ignoreInitial: true,
                followSymlinks: true,
                ignorePermissionErrors: true,
                awaitWriteFinish: {
                    stabilityThreshold: 2000,
                    pollInterval: 100
                }
            });

            this.setupWatcherEvents();
        } else {
            this.watcher.add(targetPath);
        }

        this.watchedPaths.add(targetPath);
        console.error(`Started watching: ${targetPath}`);
    }

    /**
     * Stop watching a specific path
     */
    public async unwatch(targetPath: string): Promise<void> {
        if (this.watcher && this.watchedPaths.has(targetPath)) {
            await this.watcher.unwatch(targetPath);
            this.watchedPaths.delete(targetPath);
            console.error(`Stopped watching: ${targetPath}`);
        }
    }

    /**
     * Stop watching all paths and close the watcher
     */
    public async close(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
            this.watchedPaths.clear();
            console.error('File watcher closed');
        }
    }

    /**
     * Get list of currently watched paths
     */
    public getWatchedPaths(): string[] {
        return Array.from(this.watchedPaths);
    }

    /**
     * Setup watcher event handlers
     */
    private setupWatcherEvents(): void {
        if (!this.watcher) return;

        // File added
        this.watcher.on('add', (filePath) => {
            console.error(`File ${filePath} has been added`);
            this.emit('fileAdded', filePath);
        });

        // File changed
        this.watcher.on('change', (filePath) => {
            console.error(`File ${filePath} has been changed`);
            this.cacheService.invalidate(filePath);
            this.emit('fileChanged', filePath);
        });

        // File deleted
        this.watcher.on('unlink', (filePath) => {
            console.error(`File ${filePath} has been removed`);
            this.cacheService.invalidate(filePath);
            this.emit('fileDeleted', filePath);
        });

        // Directory added
        this.watcher.on('addDir', (dirPath) => {
            console.error(`Directory ${dirPath} has been added`);
            this.emit('directoryAdded', dirPath);
        });

        // Directory deleted
        this.watcher.on('unlinkDir', (dirPath) => {
            console.error(`Directory ${dirPath} has been removed`);
            this.emit('directoryDeleted', dirPath);
        });

        // Error handling
        this.watcher.on('error', (error) => {
            console.error(`Watcher error: ${error}`);
            this.emit('error', error);
        });

        // Ready event
        this.watcher.on('ready', () => {
            console.error('Initial scan complete. Ready for changes');
            this.emit('ready');
        });
    }

    /**
     * Check if a path is currently being watched
     */
    public isWatching(targetPath: string): boolean {
        return this.watchedPaths.has(targetPath);
    }

    /**
     * Get watcher status information
     */
    public getStatus(): {
        isWatching: boolean;
        watchedPaths: string[];
        ready: boolean;
    } {
        return {
            isWatching: this.watcher !== null,
            watchedPaths: Array.from(this.watchedPaths),
            ready: this.watcher?.getWatched !== undefined
        };
    }
}
