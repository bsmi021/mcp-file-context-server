import { promises as fs } from 'fs';
import * as path from 'path';
import { Profile, ProfileConfig, ProfileState, ContextSpec } from '../types.js';
import { glob } from 'glob';
import { promisify } from 'util';
import { LoggingService } from './LoggingService.js';

const globAsync = promisify(glob);

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
    private activeProfile: Profile | null;
    private readonly configPath: string;
    private logger?: LoggingService;

    constructor(projectRoot: string, logger?: LoggingService) {
        this.logger = logger;
        this.logger?.debug('ProfileService initializing', {
            projectRoot,
            operation: 'profile_service_init'
        });
        this.projectRoot = projectRoot;
        this.configPath = path.join(projectRoot, '.llm-context', 'config.toml');
        this.config = this.createDefaultConfig();
        this.state = {
            profile_name: 'code',
            full_files: [],
            outline_files: [],
            excluded_files: [],
            timestamp: Date.now()
        };
        this.activeProfile = null;
    }

    private createDefaultConfig(): ProfileConfig {
        this.logger?.debug('Creating default configuration', {
            operation: 'create_default_config'
        });
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
        await this.logger?.info('ProfileService starting initialization', {
            projectRoot: this.projectRoot,
            configPath: this.configPath,
            operation: 'profile_service_init'
        });
        await this.loadConfig();
        await this.loadState();
    }

    private async loadConfig(): Promise<void> {
        const configPath = path.join(this.projectRoot, '.llm-context');
        try {
            await fs.mkdir(configPath, { recursive: true });
            await this.logger?.debug('Created config directory', {
                configPath,
                operation: 'load_config'
            });

            // Create default config if it doesn't exist
            const configFile = path.join(configPath, 'config.json');
            if (!await this.fileExists(configFile)) {
                await this.logger?.info('Creating default config file', {
                    configFile,
                    operation: 'load_config'
                });
                const defaultConfig = this.createDefaultConfig();
                await fs.writeFile(configFile, JSON.stringify(defaultConfig, null, 2));
                this.config = defaultConfig;
            } else {
                await this.logger?.debug('Loading existing config file', {
                    configFile,
                    operation: 'load_config'
                });
                const content = await fs.readFile(configFile, 'utf8');
                this.config = JSON.parse(content);
            }

            // Log available profiles
            await this.logger?.info('Configuration loaded successfully', {
                availableProfiles: Object.keys(this.config.profiles),
                currentProfile: this.state.profile_name,
                operation: 'load_config'
            });
        } catch (error) {
            await this.logger?.error('Failed to initialize configuration', error as Error, {
                projectRoot: this.projectRoot,
                configPath,
                operation: 'load_config'
            });
            throw error;
        }
    }

    private async loadState(): Promise<void> {
        const statePath = path.join(this.projectRoot, '.llm-context', 'state.json');
        if (!await this.fileExists(statePath)) {
            await this.logger?.info('Creating default state file', {
                statePath,
                operation: 'load_state'
            });
            await fs.writeFile(statePath, JSON.stringify(this.state, null, 2));
        } else {
            await this.logger?.debug('Loading existing state file', {
                statePath,
                operation: 'load_state'
            });
            const content = await fs.readFile(statePath, 'utf8');
            this.state = JSON.parse(content);
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
        await this.logger?.info('Attempting to set profile', {
            profileName,
            availableProfiles: Object.keys(this.config.profiles),
            operation: 'set_profile'
        });

        if (!this.config.profiles[profileName]) {
            throw new Error(`Profile '${profileName}' does not exist. Available profiles: ${Object.keys(this.config.profiles).join(', ')}`);
        }

        this.state = {
            ...this.state,
            profile_name: profileName,
            timestamp: Date.now()
        };

        await this.saveState();
        await this.logger?.info('Successfully set profile', {
            profileName,
            operation: 'set_profile'
        });
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
            this.logger?.warning('Profile not found, using default', {
                requestedProfile: profileName,
                defaultProfile: this.config.default_profile,
                operation: 'resolve_profile'
            });
            return this.config.profiles[this.config.default_profile];
        }
        return profile;
    }

    private async saveState(): Promise<void> {
        const statePath = path.join(this.projectRoot, '.llm-context', 'state.json');
        await fs.writeFile(statePath, JSON.stringify(this.state, null, 2));
        await this.logger?.debug('State saved successfully', {
            statePath,
            state: this.state,
            operation: 'save_state'
        });
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

    public async getActiveProfile(): Promise<{ profile: Profile }> {
        if (!this.activeProfile) {
            throw new Error('No active profile');
        }
        return { profile: this.activeProfile };
    }

    public async selectFiles(): Promise<void> {
        if (!this.activeProfile) {
            throw new Error('No active profile');
        }

        const fullFiles = await this.getFilteredFiles(
            this.activeProfile.gitignores.full_files,
            this.activeProfile.only_includes.full_files
        );

        const outlineFiles = await this.getFilteredFiles(
            this.activeProfile.gitignores.outline_files,
            this.activeProfile.only_includes.outline_files
        );

        this.state = {
            ...this.state,
            full_files: fullFiles,
            outline_files: outlineFiles,
            timestamp: Date.now()
        };

        await this.saveState();
    }

    private async getFilteredFiles(ignorePatterns: string[], includePatterns: string[]): Promise<string[]> {
        const allFiles: string[] = [];
        for (const pattern of includePatterns) {
            const files = await globAsync(pattern, {
                ignore: ignorePatterns,
                nodir: true,
                dot: true
            }) as string[];
            allFiles.push(...files);
        }
        return [...new Set(allFiles)];
    }
} 