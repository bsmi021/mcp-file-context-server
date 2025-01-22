import { promises as fs } from 'fs';
import * as path from 'path';
import { Profile, ProfileConfig, ProfileState, ContextSpec } from '../types.js';

const DEFAULT_IGNORE_PATTERNS = [
    '.git/',
    'node_modules/',
    'dist/',
    'build/',
    '.env',
    '.env.*',
    '*.min.*',
    '*.bundle.*',
];

const INCLUDE_ALL = ['**/*'];

export class ProfileService {
    private config: ProfileConfig;
    private state: ProfileState;
    private projectRoot: string;

    constructor(projectRoot: string) {
        console.error('[ProfileService] Initializing with root:', projectRoot);
        this.projectRoot = projectRoot;
        this.config = this.createDefaultConfig();
        this.state = {
            profile_name: 'code',
            full_files: [],
            outline_files: [],
            excluded_files: [],
            timestamp: Date.now()
        };
    }

    private createDefaultConfig(): ProfileConfig {
        console.error('[ProfileService] Creating default config');
        const defaultProfile = this.createDefaultProfile();
        return {
            profiles: {
                code: defaultProfile,
                'code-prompt': {
                    ...defaultProfile,
                    name: 'code-prompt',
                    prompt: 'prompt.md'
                }
            },
            default_profile: 'code'
        };
    }

    private createDefaultProfile(): Profile {
        return {
            name: 'code',
            gitignores: {
                full_files: DEFAULT_IGNORE_PATTERNS,
                outline_files: DEFAULT_IGNORE_PATTERNS
            },
            only_includes: {
                full_files: INCLUDE_ALL,
                outline_files: INCLUDE_ALL
            },
            settings: {
                no_media: true,
                with_user_notes: false
            }
        };
    }

    public async initialize(): Promise<void> {
        console.error('[ProfileService] Starting initialization');
        const configPath = path.join(this.projectRoot, '.llm-context');
        try {
            await fs.mkdir(configPath, { recursive: true });
            console.error('[ProfileService] Created config directory:', configPath);

            // Create default config if it doesn't exist
            const configFile = path.join(configPath, 'config.json');
            if (!await this.fileExists(configFile)) {
                console.error('[ProfileService] Creating default config file');
                const defaultConfig = this.createDefaultConfig();
                await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2));
                this.config = defaultConfig;
            } else {
                console.error('[ProfileService] Loading existing config file');
                const content = await fs.readFile(configFile, 'utf8');
                this.config = JSON.parse(content);
            }

            // Create state file if it doesn't exist
            const statePath = path.join(configPath, 'state.json');
            if (!await this.fileExists(statePath)) {
                console.error('[ProfileService] Creating default state file');
                await fs.writeFile(statePath, JSON.stringify(this.state, null, 2));
            } else {
                console.error('[ProfileService] Loading existing state file');
                const content = await fs.readFile(statePath, 'utf8');
                this.state = JSON.parse(content);
            }

            // Log available profiles
            console.error('[ProfileService] Available profiles:', Object.keys(this.config.profiles));
            console.error('[ProfileService] Current profile:', this.state.profile_name);
        } catch (error) {
            console.error('[ProfileService] Failed to initialize:', error);
            throw error;
        }
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    public async setProfile(profileName: string): Promise<void> {
        console.error(`[ProfileService] Attempting to set profile: ${profileName}`);
        console.error('[ProfileService] Available profiles:', Object.keys(this.config.profiles));

        if (!this.config.profiles[profileName]) {
            throw new Error(`Profile '${profileName}' does not exist. Available profiles: ${Object.keys(this.config.profiles).join(', ')}`);
        }

        this.state = {
            ...this.state,
            profile_name: profileName,
            timestamp: Date.now()
        };

        await this.saveState();
        console.error(`[ProfileService] Successfully set profile to: ${profileName}`);
    }

    public getContextSpec(): ContextSpec {
        const profile = this.resolveProfile(this.state.profile_name);
        return {
            profile,
            state: this.state
        };
    }

    private resolveProfile(profileName: string): Profile {
        const profile = this.config.profiles[profileName];
        if (!profile) {
            console.error(`[ProfileService] Profile ${profileName} not found, using default`);
            return this.config.profiles[this.config.default_profile];
        }
        return profile;
    }

    private async saveState(): Promise<void> {
        const statePath = path.join(this.projectRoot, '.llm-context', 'state.json');
        await fs.writeFile(statePath, JSON.stringify(this.state, null, 2));
        console.error('[ProfileService] Saved state:', this.state);
    }

    public async updateFileSelection(fullFiles: string[], outlineFiles: string[]): Promise<void> {
        this.state = {
            ...this.state,
            full_files: fullFiles,
            outline_files: outlineFiles,
            timestamp: Date.now()
        };

        await this.saveState();
    }

    public getProfile(): Profile {
        return this.resolveProfile(this.state.profile_name);
    }

    public getState(): ProfileState {
        return this.state;
    }
} 