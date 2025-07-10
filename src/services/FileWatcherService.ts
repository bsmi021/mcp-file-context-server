import { EventEmitter } from 'events';
import { watch } from 'chokidar';
import * as path from 'path';
import { LoggingService } from './LoggingService.js';

/**
 * Service for monitoring file system changes
 */
export class FileWatcherService extends EventEmitter {
    private watchers: Map<string, any> = new Map();
    private logger?: LoggingService;

    constructor(logger?: LoggingService) {
        super();
        this.logger = logger;
    }

    /**
     * Start watching a path for changes
     */
    public async watch(targetPath: string): Promise<void> {
        if (this.watchers.has(targetPath)) {
            return;
        }

        if (!this.watchers.has(targetPath)) {
            this.watchers.set(targetPath, watch(targetPath, {
                persistent: true,
                ignoreInitial: true,
                usePolling: true,
                interval: 100,
                binaryInterval: 300,
                awaitWriteFinish: {
                    stabilityThreshold: 2000,
                    pollInterval: 100
                }
            }));

            this.setupWatcherEvents(targetPath);
        } else {
            this.watchers.get(targetPath).add(targetPath);
        }

        await this.logger?.info('Started watching path', {
            targetPath,
            operation: 'file_watch_start'
        });
    }

    /**
     * Stop watching a path
     */
    public async unwatch(targetPath: string): Promise<void> {
        if (this.watchers.has(targetPath)) {
            await this.watchers.get(targetPath).unwatch(targetPath);
            this.watchers.delete(targetPath);
            await this.logger?.info('Stopped watching path', {
                targetPath,
                operation: 'file_watch_stop'
            });
        }
    }

    /**
     * Close all watchers
     */
    public async close(): Promise<void> {
        if (this.watchers.size > 0) {
            for (const watcher of this.watchers.values()) {
                await watcher.close();
            }
            this.watchers.clear();
            await this.logger?.info('File watcher closed', {
                operation: 'file_watch_close'
            });
        }
    }

    /**
     * Get list of watched paths
     */
    public getWatchedPaths(): string[] {
        return Array.from(this.watchers.keys());
    }

    /**
     * Setup watcher event handlers
     */
    private setupWatcherEvents(targetPath: string): void {
        if (!this.watchers.has(targetPath)) return;

        const watcher = this.watchers.get(targetPath);

        // File added
        watcher.on('add', (filePath: string) => {
            this.logger?.debug('File added', {
                filePath,
                targetPath,
                operation: 'file_watch_event'
            });
            this.emit('fileAdded', filePath);
        });

        // File changed
        watcher.on('change', (filePath: string) => {
            this.logger?.debug('File changed', {
                filePath,
                targetPath,
                operation: 'file_watch_event'
            });
            this.emit('fileChanged', filePath);
        });

        // File deleted
        watcher.on('unlink', (filePath: string) => {
            this.logger?.debug('File removed', {
                filePath,
                targetPath,
                operation: 'file_watch_event'
            });
            this.emit('fileDeleted', filePath);
        });

        // Directory added
        watcher.on('addDir', (dirPath: string) => {
            this.logger?.debug('Directory added', {
                dirPath,
                targetPath,
                operation: 'file_watch_event'
            });
            this.emit('directoryAdded', dirPath);
        });

        // Directory deleted
        watcher.on('unlinkDir', (dirPath: string) => {
            this.logger?.debug('Directory removed', {
                dirPath,
                targetPath,
                operation: 'file_watch_event'
            });
            this.emit('directoryDeleted', dirPath);
        });

        // Error handling
        watcher.on('error', (error: Error) => {
            this.logger?.error('Watcher error', error, {
                targetPath,
                operation: 'file_watch_event'
            });
            this.emit('error', error);
        });

        // Ready event
        watcher.on('ready', () => {
            this.logger?.info('Initial scan complete, ready for changes', {
                targetPath,
                operation: 'file_watch_ready'
            });
            this.emit('ready');
        });
    }

    /**
     * Check if a path is being watched
     */
    public isWatching(targetPath: string): boolean {
        return this.watchers.has(targetPath);
    }

    /**
     * Get watcher status
     */
    public getStatus(): { isWatching: boolean; watchedPaths: string[]; ready: boolean } {
        return {
            isWatching: this.watchers.size > 0,
            watchedPaths: Array.from(this.watchers.keys()),
            ready: this.watchers.size > 0 && this.watchers.get(Array.from(this.watchers.keys())[0])?.getWatched !== undefined
        };
    }
}
