import LRUCache from 'lru-cache';
import { CacheEntry, FileContent, CodeAnalysis } from '../types.js';

interface EnhancedCacheEntry extends CacheEntry {
    hits: number;
    lastAccessed: Date;
    size: number;
}

interface CacheStats {
    size: number;
    maxSize: number;
    itemCount: number;
    hitRate: number;
    missRate: number;
}

/**
 * Service for caching file contents and analysis results
 * Uses LRU (Least Recently Used) caching strategy with enhanced metrics
 */
export class CacheService {
    private cache: LRUCache<string, EnhancedCacheEntry>;
    private hits: number = 0;
    private misses: number = 0;

    constructor(options: {
        maxSize?: number;
        ttl?: number;
    } = {}) {
        this.cache = new LRUCache({
            max: options.maxSize || 1000,
            // Increase TTL to 1 hour for better persistence
            ttl: options.ttl || 1000 * 60 * 60,
            updateAgeOnGet: true,
            // Allow stale data while revalidating
            allowStale: true,
            // Add noDisposeOnSet for last_read_result
            noDisposeOnSet: true
        });
    }

    /**
     * Get cached entry for a file path
     */
    public get(path: string): EnhancedCacheEntry | undefined {
        const entry = this.cache.get(path);

        // Special handling for last_read_result
        if (path === 'last_read_result') {
            if (entry) {
                this.hits++;
                entry.hits++;
                entry.lastAccessed = new Date();
            } else {
                this.misses++;
            }
            return entry;
        }

        if (entry) {
            this.hits++;
            entry.hits++;
            entry.lastAccessed = new Date();
            try {
                // Use async stat check to avoid blocking
                const { promises: fs } = require('fs');
                const stats = fs.statSync(path);
                if (stats.mtimeMs > entry.lastModified) {
                    this.invalidate(path);
                    return undefined;
                }
            } catch (error) {
                console.error(`Error checking file stats for ${path}:`, error);
                return undefined;
            }
        }
        return entry;
    }

    /**
     * Cache file content and optional analysis
     */
    public set(path: string, content: FileContent, analysis?: CodeAnalysis): void {
        const entry: EnhancedCacheEntry = {
            content,
            analysis,
            lastModified: Date.now(),
            hits: 0,
            lastAccessed: new Date(),
            size: this.calculateSize(content)
        };

        // Special handling for last_read_result
        if (path === 'last_read_result') {
            // Store with infinite TTL
            this.cache.set(path, entry, { ttl: Infinity });
        } else {
            this.cache.set(path, entry);
        }
    }

    /**
     * Remove entry from cache
     */
    public invalidate(path: string): void {
        this.cache.delete(path);
    }

    /**
     * Clear entire cache
     */
    public clear(): void {
        this.cache.clear();
    }

    /**
     * Check if path exists in cache
     */
    public has(path: string): boolean {
        if (!this.cache.has(path)) {
            return false;
        }
        // Verify entry isn't stale
        const entry = this.get(path);
        return entry !== undefined;
    }

    /**
     * Get cache statistics with enhanced metrics
     */
    public getStats(): CacheStats {
        const totalRequests = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.cache.max,
            itemCount: this.cache.size,
            hitRate: totalRequests ? this.hits / totalRequests : 0,
            missRate: totalRequests ? this.misses / totalRequests : 0
        };
    }

    /**
     * Get detailed information about all cache entries
     */
    public getEntries(): Array<{ key: string } & EnhancedCacheEntry> {
        return Array.from(this.cache.entries()).map(([key, entry]) => ({
            key,
            ...entry
        }));
    }

    /**
     * Calculate approximate memory size of cached content
     */
    private calculateSize(content: FileContent): number {
        return Buffer.byteLength(JSON.stringify(content));
    }

    /**
     * Prune stale entries
     */
    public prune(): void {
        this.cache.purgeStale();
    }
}
