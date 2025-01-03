import { CodeAnalysis } from '../types.js';
import * as path from 'path';

const MAX_LINE_LENGTH = 100;

/**
 * Service for analyzing code files and extracting metrics
 */
export class CodeAnalysisService {
    /**
     * Calculate cyclomatic complexity from code patterns
     */
    private calculateComplexity(content: string): number {
        const patterns = [
            /if\s*\(/g,
            /else\s+if/g,
            /else/g,
            /for\s*\(/g,
            /while\s*\(/g,
            /case\s+/g,
            /catch\s*\(/g,
            /\|\|/g,
            /&&/g,
            /\?/g
        ];

        return patterns.reduce((complexity, pattern) => {
            const matches = content.match(pattern);
            return complexity + (matches ? matches.length : 0);
        }, 1);
    }

    /**
     * Extract dependencies from imports and requires
     */
    private extractDependencies(content: string, filePath: string): string[] {
        const ext = path.extname(filePath).toLowerCase();
        const dependencies = new Set<string>();

        // JavaScript/TypeScript imports
        if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
            const importMatches = content.matchAll(/import\s+.*\s+from\s+['"]([^'"]+)['"]/g);
            const requireMatches = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);

            for (const match of importMatches) {
                dependencies.add(match[1]);
            }
            for (const match of requireMatches) {
                dependencies.add(match[1]);
            }
        }

        // Python imports
        if (ext === '.py') {
            const importMatches = content.matchAll(/(?:from|import)\s+(\w+)/g);
            for (const match of importMatches) {
                dependencies.add(match[1]);
            }
        }

        return Array.from(dependencies);
    }

    /**
     * Count comment lines based on file type
     */
    private countCommentLines(content: string, filePath: string): number {
        const ext = path.extname(filePath).toLowerCase();
        const lines = content.split('\n');
        let commentCount = 0;

        const commentPatterns: { [key: string]: RegExp[] } = {
            '.js': [/^\s*\/\//, /^\s*\/\*/],
            '.ts': [/^\s*\/\//, /^\s*\/\*/],
            '.py': [/^\s*#/],
            '.java': [/^\s*\/\//, /^\s*\/\*/],
            '.cs': [/^\s*\/\//, /^\s*\/\*/],
            '.go': [/^\s*\/\//],
            '.rb': [/^\s*#/]
        };

        const patterns = commentPatterns[ext] || [];
        for (const line of lines) {
            if (patterns.some(pattern => pattern.test(line))) {
                commentCount++;
            }
        }

        return commentCount;
    }

    /**
     * Find duplicate lines in code
     */
    private findDuplicateLines(content: string): number {
        const lines = content.split('\n');
        const lineMap = new Map<string, number>();
        let duplicates = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
                const count = (lineMap.get(trimmed) || 0) + 1;
                lineMap.set(trimmed, count);
                if (count > 1) duplicates++;
            }
        }

        return duplicates;
    }

    /**
     * Count lines exceeding maximum length
     */
    private findLongLines(content: string): number {
        return content.split('\n')
            .filter(line => line.length > MAX_LINE_LENGTH)
            .length;
    }

    /**
     * Count functions with high complexity
     */
    private findComplexFunctions(content: string): number {
        const functionMatches = content.match(/(?:function|class)\s*\w*\s*\([^)]*\)\s*{[^}]*}/g) || [];
        return functionMatches.filter(func => this.calculateComplexity(func) > 10).length;
    }

    /**
     * Analyze code content and extract metrics
     */
    public analyze(content: string, filePath: string): CodeAnalysis {
        try {
            const lines = content.split('\n');
            const nonEmptyLines = lines.filter(line => line.trim().length > 0).length;

            return {
                metrics: {
                    lines: lines.length,
                    nonEmptyLines,
                    commentLines: this.countCommentLines(content, filePath),
                    complexity: this.calculateComplexity(content)
                },
                dependencies: this.extractDependencies(content, filePath),
                quality: {
                    duplicateLines: this.findDuplicateLines(content),
                    longLines: this.findLongLines(content),
                    complexFunctions: this.findComplexFunctions(content)
                }
            };
        } catch (error) {
            console.error(`Error analyzing ${filePath}:`, error);
            return {
                metrics: {
                    lines: 0,
                    nonEmptyLines: 0,
                    commentLines: 0,
                    complexity: 0
                },
                dependencies: [],
                quality: {
                    duplicateLines: 0,
                    longLines: 0,
                    complexFunctions: 0
                }
            };
        }
    }
}
