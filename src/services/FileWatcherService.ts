import { EventEmitter } from 'events';
import { watch } from 'chokidar';
import * as path from 'path';

/**
 * Service for monitoring file system changes
 */
export class FileWatcherService extends EventEmitter {
    private watchers: Map<string, any> = new Map();

    constructor() {
        super();
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

        console.error(`Started watching: ${targetPath}`);
    }

    /**
     * Stop watching a path
     */
    public async unwatch(targetPath: string): Promise<void> {
        if (this.watchers.has(targetPath)) {
            await this.watchers.get(targetPath).unwatch(targetPath);
            this.watchers.delete(targetPath);
            console.error(`Stopped watching: ${targetPath}`);
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
            console.error('File watcher closed');
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
            console.error(`File ${filePath} has been added`);
            this.emit('fileAdded', filePath);
        });

        // File changed
        watcher.on('change', (filePath: string) => {
            console.error(`File ${filePath} has been changed`);
            this.emit('fileChanged', filePath);
        });

        // File deleted
        watcher.on('unlink', (filePath: string) => {
            console.error(`File ${filePath} has been removed`);
            this.emit('fileDeleted', filePath);
        });

        // Directory added
        watcher.on('addDir', (dirPath: string) => {
            console.error(`Directory ${dirPath} has been added`);
            this.emit('directoryAdded', dirPath);
        });

        // Directory deleted
        watcher.on('unlinkDir', (dirPath: string) => {
            console.error(`Directory ${dirPath} has been removed`);
            this.emit('directoryDeleted', dirPath);
        });

        // Error handling
        watcher.on('error', (error: Error) => {
            console.error(`Watcher error: ${error}`);
            this.emit('error', error);
        });

        // Ready event
        watcher.on('ready', () => {
            console.error('Initial scan complete. Ready for changes');
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
