// Utility functions related to file operations, types, and extensions
import * as path from 'path';

export function getLanguageFromExtension(ext: string): string | null {
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
        // Add more mappings as needed
    };
    return extensionMap[ext.toLowerCase()] || null;
}

export function getFileType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath).toLowerCase();

    // Common file type mappings - this can be expanded
    const typeMap: Record<string, string> = {
        '.ts': 'TypeScript',
        '.tsx': 'TypeScript', // Added for .tsx
        '.js': 'JavaScript',
        '.jsx': 'JavaScript', // Added for .jsx
        '.py': 'Python',
        '.json': 'JSON',
        '.md': 'Markdown',
        '.txt': 'Text',
        '.html': 'HTML',
        '.css': 'CSS',
        '.scss': 'SCSS',
        '.less': 'LESS',
        '.xml': 'XML',
        '.yaml': 'YAML',
        '.yml': 'YAML',
        '.sh': 'Shell',
        '.bash': 'Shell',
        '.zsh': 'Shell',
        '.fish': 'Shell',
        '.sql': 'SQL',
        '.env': 'Environment',
        'dockerfile': 'Docker',
        '.dockerignore': 'Docker',
        '.gitignore': 'Git',
        'package.json': 'NPM',
        'tsconfig.json': 'TypeScript Config',
        '.eslintrc': 'ESLint Config',
        '.prettierrc': 'Prettier Config'
        // Add more specific filenames or extensions
    };

    // Check for exact filename matches first
    if (typeMap[filename]) {
        return typeMap[filename];
    }

    // Then check extensions
    return typeMap[ext] || 'Unknown';
}

export function isMediaFile(filePath: string): boolean {
    const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.mp4', '.avi', '.mov', '.webm', '.mkv', '.mp3', '.wav', '.ogg'];
    const ext = path.extname(filePath).toLowerCase();
    return mediaExtensions.includes(ext);
}
