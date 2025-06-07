import { getLanguageFromExtension, getFileType, isMediaFile } from '../../../src/utils/fileUtils';

describe('fileUtils', () => {
  describe('getLanguageFromExtension', () => {
    it('should return python for py extension', () => {
      expect(getLanguageFromExtension('py')).toBe('python');
    });

    it('should return typescript for ts extension', () => {
      expect(getLanguageFromExtension('ts')).toBe('typescript');
    });

    it('should return typescript for tsx extension', () => {
      expect(getLanguageFromExtension('tsx')).toBe('typescript');
    });

    it('should return javascript for js extension', () => {
      expect(getLanguageFromExtension('js')).toBe('javascript');
    });

    it('should return javascript for jsx extension', () => {
      expect(getLanguageFromExtension('jsx')).toBe('javascript');
    });

    it('should return csharp for cs extension', () => {
      expect(getLanguageFromExtension('cs')).toBe('csharp');
    });

    it('should return go for go extension', () => {
      expect(getLanguageFromExtension('go')).toBe('go');
    });

    it('should return bash for sh extension', () => {
      expect(getLanguageFromExtension('sh')).toBe('bash');
    });

    it('should return null for an unknown extension', () => {
      expect(getLanguageFromExtension('unknown')).toBeNull();
    });

    it('should be case-insensitive', () => {
      expect(getLanguageFromExtension('PY')).toBe('python');
    });

    it('should return null for an empty extension', () => {
      expect(getLanguageFromExtension('')).toBeNull();
    });
  });

  describe('getFileType', () => {
    it('should identify TypeScript files by extension', () => {
      expect(getFileType('example.ts')).toBe('TypeScript');
      expect(getFileType('path/to/another.tsx')).toBe('TypeScript');
    });

    it('should identify JavaScript files by extension', () => {
      expect(getFileType('example.js')).toBe('JavaScript');
      expect(getFileType('path/to/another.jsx')).toBe('JavaScript');
    });

    it('should identify Python files by extension', () => {
      expect(getFileType('script.py')).toBe('Python');
    });

    it('should identify JSON files by extension', () => {
      expect(getFileType('data.json')).toBe('JSON');
    });

    it('should identify Markdown files by extension', () => {
      expect(getFileType('README.MD')).toBe('Markdown');
    });

    it('should identify specific filenames like Dockerfile', () => {
      expect(getFileType('Dockerfile')).toBe('Docker');
      expect(getFileType('path/to/Dockerfile')).toBe('Docker');
    });

    it('should identify package.json specifically', () => {
      expect(getFileType('package.json')).toBe('NPM');
    });

    it('should return "Unknown" for unknown extensions/filenames', () => {
      expect(getFileType('file.unknown')).toBe('Unknown');
      expect(getFileType('no_extension_here')).toBe('Unknown'); // Assuming basename match fails
    });

     it('should be case-insensitive for extensions and filenames', () => {
      expect(getFileType('EXAMPLE.TS')).toBe('TypeScript');
      expect(getFileType('DOCKERFILE')).toBe('Docker');
    });
  });

  describe('isMediaFile', () => {
    it('should return true for common image extensions', () => {
      expect(isMediaFile('image.jpg')).toBe(true);
      expect(isMediaFile('photo.jpeg')).toBe(true);
      expect(isMediaFile('logo.png')).toBe(true);
      expect(isMediaFile('animation.gif')).toBe(true);
    });

    it('should return true for common video extensions', () => {
      expect(isMediaFile('movie.mp4')).toBe(true);
      expect(isMediaFile('clip.avi')).toBe(true);
      expect(isMediaFile('recording.mov')).toBe(true);
    });

    it('should return true for common audio extensions', () => {
      expect(isMediaFile('song.mp3')).toBe(true);
      expect(isMediaFile('sound.wav')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(isMediaFile('IMAGE.JPG')).toBe(true);
      expect(isMediaFile('MOVIE.MP4')).toBe(true);
    });

    it('should return false for non-media extensions', () => {
      expect(isMediaFile('document.pdf')).toBe(false);
      expect(isMediaFile('script.ts')).toBe(false);
      expect(isMediaFile('archive.zip')).toBe(false);
      expect(isMediaFile('README.md')).toBe(false);
    });

    it('should handle paths correctly', () => {
      expect(isMediaFile('path/to/image.png')).toBe(true);
      expect(isMediaFile('path/to/document.txt')).toBe(false);
    });
  });
});
