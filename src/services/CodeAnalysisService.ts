import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as parser from '@typescript-eslint/parser';
import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/types';
import { FileContent } from '../types.js';
import { LoggingService } from './LoggingService.js';

const execAsync = promisify(exec);

export interface SecurityIssue {
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    line?: number;
    column?: number;
}

export interface StyleViolation {
    rule: string;
    message: string;
    line: number;
    column: number;
}

export interface ComplexityMetrics {
    cyclomaticComplexity: number;
    maintainabilityIndex: number;
    linesOfCode: number;
    numberOfFunctions: number;
    branchCount: number;
    returnCount: number;
    maxNestingDepth: number;
    averageFunctionComplexity: number;
    functionMetrics: FunctionMetrics[];
}

export interface FunctionMetrics {
    name: string;
    startLine: number;
    endLine: number;
    complexity: number;
    parameterCount: number;
    returnCount: number;
    localVariables: number;
    nestingDepth: number;
}

export interface CodeMetrics {
    complexity: number;
    lineCount: {
        total: number;
        code: number;
        comment: number;
        blank: number;
    };
    quality: {
        longLines: number;
        duplicateLines: number;
        complexFunctions: number;
    };
    dependencies: string[];
    imports: string[];
    definitions: {
        classes: string[];
        functions: string[];
        variables: string[];
    };
}

export interface CodeAnalysisResult {
    metrics: CodeMetrics;
    outline: string;
    language: string;
    security_issues: any[];
    style_violations: any[];
    complexity_metrics: any;
}

interface LanguageConfig {
    extensions: string[];
    securityTool?: string;
    styleTool?: string;
    complexityTool?: string;
    parser?: (code: string) => TSESTree.Program;
}

export class CodeAnalysisService {
    private tempDir: string;
    private languageConfigs: Record<string, LanguageConfig>;
    private readonly LONG_LINE_THRESHOLD = 100;
    private readonly COMPLEX_FUNCTION_THRESHOLD = 10;
    private logger?: LoggingService;

    constructor(logger?: LoggingService) {
        this.logger = logger;
        this.tempDir = path.join(process.cwd(), '.temp');
        this.languageConfigs = {
            python: {
                extensions: ['.py'],
                securityTool: 'bandit',
                styleTool: 'pylint',
                complexityTool: 'radon'
            },
            typescript: {
                extensions: ['.ts', '.tsx'],
                securityTool: 'tsc --noEmit',
                styleTool: 'eslint',
                parser: (code: string) => parser.parse(code, {
                    sourceType: 'module',
                    ecmaFeatures: { jsx: true }
                })
            },
            javascript: {
                extensions: ['.js', '.jsx'],
                securityTool: 'eslint',
                styleTool: 'eslint',
                parser: (code: string) => parser.parse(code, {
                    sourceType: 'module',
                    ecmaFeatures: { jsx: true }
                })
            },
            csharp: {
                extensions: ['.cs'],
                securityTool: 'security-code-scan',
                styleTool: 'dotnet format',
                complexityTool: 'ndepend'
            },
            go: {
                extensions: ['.go'],
                securityTool: 'gosec',
                styleTool: 'golint',
                complexityTool: 'gocyclo'
            },
            bash: {
                extensions: ['.sh', '.bash'],
                securityTool: 'shellcheck',
                styleTool: 'shellcheck',
                complexityTool: 'shellcheck'
            }
        };
    }

    public async initialize(): Promise<void> {
        await fs.mkdir(this.tempDir, { recursive: true });
    }

    public async analyzeCode(content: string, filePath: string): Promise<CodeAnalysisResult> {
        const ext = path.extname(filePath).toLowerCase();
        const language = this.getLanguage(ext);

        const metrics = await this.calculateMetrics(content, language);
        const outline = await this.generateOutline(content, language);

        return {
            metrics,
            outline,
            language,
            security_issues: [],  // TODO: Implement security analysis
            style_violations: [], // TODO: Implement style analysis
            complexity_metrics: {
                cyclomaticComplexity: metrics.complexity,
                linesOfCode: metrics.lineCount.code,
                maintainabilityIndex: 100 - (metrics.quality.longLines + metrics.quality.duplicateLines) / metrics.lineCount.total * 100
            }
        };
    }

    private getLanguage(ext: string): string {
        const map: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.go': 'go',
            '.java': 'java',
            '.cs': 'csharp',
            '.cpp': 'cpp',
            '.c': 'c',
            '.rb': 'ruby'
        };
        return map[ext] || 'unknown';
    }

    private async calculateMetrics(content: string, language: string): Promise<CodeMetrics> {
        const lines = content.split('\n');

        const lineCount = this.calculateLineCount(lines, language);
        const complexity = this.calculateComplexity(content, language);
        const quality = this.calculateQualityMetrics(lines);
        const { imports, dependencies } = this.extractDependencies(content, language);
        const definitions = this.extractDefinitions(content, language);

        return {
            complexity,
            lineCount,
            quality,
            dependencies,
            imports,
            definitions
        };
    }

    private calculateLineCount(lines: string[], language: string): CodeMetrics['lineCount'] {
        let code = 0;
        let comment = 0;
        let blank = 0;
        let inMultilineComment = false;

        const commentStart = this.getCommentPatterns(language);

        for (const line of lines) {
            const trimmed = line.trim();

            if (!trimmed) {
                blank++;
                continue;
            }

            if (inMultilineComment) {
                comment++;
                if (commentStart.multiEnd && trimmed.includes(commentStart.multiEnd)) {
                    inMultilineComment = false;
                }
                continue;
            }

            if (commentStart.multi && trimmed.startsWith(commentStart.multi)) {
                comment++;
                inMultilineComment = true;
                continue;
            }

            if (commentStart.single.some(pattern => trimmed.startsWith(pattern))) {
                comment++;
            } else {
                code++;
            }
        }

        return {
            total: lines.length,
            code,
            comment,
            blank
        };
    }

    private calculateComplexity(content: string, language: string): number {
        let complexity = 1;
        const patterns = [
            /\bif\b/g,
            /\belse\b/g,
            /\bwhile\b/g,
            /\bfor\b/g,
            /\bforeach\b/g,
            /\bcase\b/g,
            /\bcatch\b/g,
            /\b\|\|\b/g,
            /\b&&\b/g,
            /\?/g
        ];

        patterns.forEach(pattern => {
            const matches = content.match(pattern);
            if (matches) {
                complexity += matches.length;
            }
        });

        return complexity;
    }

    private calculateQualityMetrics(lines: string[]): CodeMetrics['quality'] {
        const longLines = lines.filter(line => line.length > this.LONG_LINE_THRESHOLD).length;

        // Simple duplicate line detection
        const lineSet = new Set<string>();
        let duplicateLines = 0;
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed && lineSet.has(trimmed)) {
                duplicateLines++;
            } else {
                lineSet.add(trimmed);
            }
        });

        // Count complex functions based on line count and complexity
        const complexFunctions = this.countComplexFunctions(lines.join('\n'));

        return {
            longLines,
            duplicateLines,
            complexFunctions
        };
    }

    private countComplexFunctions(content: string): number {
        const functionMatches = content.match(/\bfunction\s+\w+\s*\([^)]*\)\s*{[^}]*}/g) || [];
        return functionMatches.filter(func => {
            const complexity = this.calculateComplexity(func, 'unknown');
            return complexity > this.COMPLEX_FUNCTION_THRESHOLD;
        }).length;
    }

    private extractDependencies(content: string, language: string): { imports: string[], dependencies: string[] } {
        const imports: string[] = [];
        const dependencies: string[] = [];

        switch (language) {
            case 'typescript':
            case 'javascript':
                const importMatches = content.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/g) || [];
                const requireMatches = content.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g) || [];

                importMatches.forEach(match => {
                    const [, path] = match.match(/from\s+['"]([^'"]+)['"]/) || [];
                    if (path) imports.push(path);
                });

                requireMatches.forEach(match => {
                    const [, path] = match.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/) || [];
                    if (path) dependencies.push(path);
                });
                break;

            case 'python':
                const pythonImports = content.match(/(?:from\s+(\S+)\s+)?import\s+(\S+)(?:\s+as\s+\S+)?/g) || [];
                pythonImports.forEach(match => {
                    const [, from, module] = match.match(/(?:from\s+(\S+)\s+)?import\s+(\S+)/) || [];
                    if (from) imports.push(from);
                    if (module) imports.push(module);
                });
                break;
        }

        return { imports, dependencies };
    }

    private extractDefinitions(content: string, language: string): CodeMetrics['definitions'] {
        const definitions: CodeMetrics['definitions'] = {
            classes: [],
            functions: [],
            variables: []
        };

        switch (language) {
            case 'typescript':
            case 'javascript':
                // Classes
                const classMatches = content.match(/class\s+(\w+)/g) || [];
                definitions.classes = classMatches.map(match => match.split(/\s+/)[1]);

                // Functions
                const functionMatches = content.match(/(?:function|const|let|var)\s+(\w+)\s*(?:=\s*(?:function|\([^)]*\)\s*=>)|\([^)]*\))/g) || [];
                definitions.functions = functionMatches.map(match => {
                    const [, name] = match.match(/(?:function|const|let|var)\s+(\w+)/) || [];
                    return name;
                }).filter(Boolean);

                // Variables
                const varMatches = content.match(/(?:const|let|var)\s+(\w+)\s*=/g) || [];
                definitions.variables = varMatches.map(match => {
                    const [, name] = match.match(/(?:const|let|var)\s+(\w+)/) || [];
                    return name;
                }).filter(Boolean);
                break;

            case 'python':
                // Classes
                const pyClassMatches = content.match(/class\s+(\w+)(?:\([^)]*\))?:/g) || [];
                definitions.classes = pyClassMatches.map(match => {
                    const [, name] = match.match(/class\s+(\w+)/) || [];
                    return name;
                }).filter(Boolean);

                // Functions
                const pyFuncMatches = content.match(/def\s+(\w+)\s*\([^)]*\):/g) || [];
                definitions.functions = pyFuncMatches.map(match => {
                    const [, name] = match.match(/def\s+(\w+)/) || [];
                    return name;
                }).filter(Boolean);

                // Variables
                const pyVarMatches = content.match(/(\w+)\s*=(?!=)/g) || [];
                definitions.variables = pyVarMatches.map(match => {
                    const [, name] = match.match(/(\w+)\s*=/) || [];
                    return name;
                }).filter(Boolean);
                break;
        }

        return definitions;
    }

    private getCommentPatterns(language: string): { single: string[], multi?: string, multiEnd?: string } {
        switch (language) {
            case 'typescript':
            case 'javascript':
                return {
                    single: ['//'],
                    multi: '/*',
                    multiEnd: '*/'
                };
            case 'python':
                return {
                    single: ['#']
                };
            case 'ruby':
                return {
                    single: ['#']
                };
            default:
                return {
                    single: ['//'],
                    multi: '/*',
                    multiEnd: '*/'
                };
        }
    }

    private async generateOutline(content: string, language: string): Promise<string> {
        const metrics = await this.calculateMetrics(content, language);

        const sections: string[] = [];

        // Add imports section
        if (metrics.imports.length > 0) {
            sections.push('Imports:', ...metrics.imports.map(imp => `  - ${imp}`));
        }

        // Add definitions section
        if (metrics.definitions.classes.length > 0) {
            sections.push('\nClasses:', ...metrics.definitions.classes.map(cls => `  - ${cls}`));
        }

        if (metrics.definitions.functions.length > 0) {
            sections.push('\nFunctions:', ...metrics.definitions.functions.map(func => `  - ${func}`));
        }

        // Add metrics section
        sections.push('\nMetrics:',
            `  Lines: ${metrics.lineCount.total} (${metrics.lineCount.code} code, ${metrics.lineCount.comment} comments, ${metrics.lineCount.blank} blank)`,
            `  Complexity: ${metrics.complexity}`,
            `  Quality Issues:`,
            `    - ${metrics.quality.longLines} long lines`,
            `    - ${metrics.quality.duplicateLines} duplicate lines`,
            `    - ${metrics.quality.complexFunctions} complex functions`
        );

        return sections.join('\n');
    }

    private analyzeAst(ast: TSESTree.Node): ComplexityMetrics {
        const functionMetrics: FunctionMetrics[] = [];
        let totalComplexity = 0;
        let maxNestingDepth = 0;
        let branchCount = 0;
        let returnCount = 0;

        const visitNode = (node: TSESTree.Node, depth: number = 0): void => {
            maxNestingDepth = Math.max(maxNestingDepth, depth);

            switch (node.type) {
                case AST_NODE_TYPES.FunctionDeclaration:
                case AST_NODE_TYPES.FunctionExpression:
                case AST_NODE_TYPES.ArrowFunctionExpression:
                case AST_NODE_TYPES.MethodDefinition:
                    const metrics = this.analyzeFunctionNode(node, depth);
                    functionMetrics.push(metrics);
                    totalComplexity += metrics.complexity;
                    break;

                case AST_NODE_TYPES.IfStatement:
                case AST_NODE_TYPES.SwitchCase:
                case AST_NODE_TYPES.ConditionalExpression:
                    branchCount++;
                    break;

                case AST_NODE_TYPES.ReturnStatement:
                    returnCount++;
                    break;
            }

            // Recursively visit children
            for (const key in node) {
                const child = (node as any)[key];
                if (child && typeof child === 'object') {
                    if (Array.isArray(child)) {
                        child.forEach(item => {
                            if (item && typeof item === 'object' && item.type) {
                                visitNode(item as TSESTree.Node, depth + 1);
                            }
                        });
                    } else if (child.type) {
                        visitNode(child as TSESTree.Node, depth + 1);
                    }
                }
            }
        };

        visitNode(ast);

        const averageFunctionComplexity = functionMetrics.length > 0
            ? totalComplexity / functionMetrics.length
            : 0;

        return {
            cyclomaticComplexity: totalComplexity,
            maintainabilityIndex: this.calculateMaintainabilityIndex(totalComplexity, ast.loc?.end.line || 0),
            linesOfCode: ast.loc?.end.line || 0,
            numberOfFunctions: functionMetrics.length,
            branchCount,
            returnCount,
            maxNestingDepth,
            averageFunctionComplexity,
            functionMetrics
        };
    }

    private analyzeFunctionNode(node: TSESTree.Node, depth: number): FunctionMetrics {
        let complexity = 1; // Base complexity
        let returnCount = 0;
        let localVariables = 0;

        const visitFunctionNode = (node: TSESTree.Node): void => {
            switch (node.type) {
                case AST_NODE_TYPES.IfStatement:
                case AST_NODE_TYPES.SwitchCase:
                case AST_NODE_TYPES.ConditionalExpression:
                case AST_NODE_TYPES.LogicalExpression:
                    complexity++;
                    break;

                case AST_NODE_TYPES.ReturnStatement:
                    returnCount++;
                    break;

                case AST_NODE_TYPES.VariableDeclaration:
                    localVariables += node.declarations.length;
                    break;
            }

            // Recursively visit children
            for (const key in node) {
                const child = (node as any)[key];
                if (child && typeof child === 'object') {
                    if (Array.isArray(child)) {
                        child.forEach(item => {
                            if (item && typeof item === 'object' && item.type) {
                                visitFunctionNode(item as TSESTree.Node);
                            }
                        });
                    } else if (child.type) {
                        visitFunctionNode(child as TSESTree.Node);
                    }
                }
            }
        };

        visitFunctionNode(node);

        return {
            name: this.getFunctionName(node),
            startLine: node.loc?.start.line || 0,
            endLine: node.loc?.end.line || 0,
            complexity,
            parameterCount: this.getParameterCount(node),
            returnCount,
            localVariables,
            nestingDepth: depth
        };
    }

    private getFunctionName(node: TSESTree.Node): string {
        switch (node.type) {
            case AST_NODE_TYPES.FunctionDeclaration:
                return node.id?.name || 'anonymous';
            case AST_NODE_TYPES.MethodDefinition:
                return node.key.type === AST_NODE_TYPES.Identifier ? node.key.name : 'computed';
            default:
                return 'anonymous';
        }
    }

    private getParameterCount(node: TSESTree.Node): number {
        switch (node.type) {
            case AST_NODE_TYPES.FunctionDeclaration:
            case AST_NODE_TYPES.FunctionExpression:
            case AST_NODE_TYPES.ArrowFunctionExpression:
                return node.params.length;
            case AST_NODE_TYPES.MethodDefinition:
                return node.value.params.length;
            default:
                return 0;
        }
    }

    private calculateMaintainabilityIndex(complexity: number, linesOfCode: number): number {
        // Maintainability Index formula:
        // 171 - 5.2 * ln(Halstead Volume) - 0.23 * (Cyclomatic Complexity) - 16.2 * ln(Lines of Code)
        // We're using a simplified version since we don't calculate Halstead Volume
        const mi = 171 - (0.23 * complexity) - (16.2 * Math.log(linesOfCode));
        return Math.max(0, Math.min(100, mi));
    }

    private async runSecurityAnalysis(filePath: string, config: LanguageConfig): Promise<SecurityIssue[]> {
        if (!config.securityTool) {
            return [];
        }

        try {
            const { stdout } = await execAsync(`${config.securityTool} ${filePath}`);
            return this.parseSecurityOutput(stdout, config.securityTool);
        } catch (error) {
            await this.logger?.warning('Security analysis failed', {
                filePath,
                securityTool: config.securityTool,
                error: error instanceof Error ? error.message : String(error),
                operation: 'security_analysis'
            });
            return [];
        }
    }

    private async runStyleAnalysis(filePath: string, config: LanguageConfig): Promise<StyleViolation[]> {
        if (!config.styleTool) {
            return [];
        }

        try {
            const { stdout } = await execAsync(`${config.styleTool} ${filePath}`);
            return this.parseStyleOutput(stdout, config.styleTool);
        } catch (error) {
            await this.logger?.warning('Style analysis failed', {
                filePath,
                styleTool: config.styleTool,
                error: error instanceof Error ? error.message : String(error),
                operation: 'style_analysis'
            });
            return [];
        }
    }

    private getDefaultComplexityMetrics(code: string): ComplexityMetrics {
        const lines = code.split('\n');
        const functionMatches = code.match(/function|def|func|method/g);
        const branchMatches = code.match(/if|else|switch|case|while|for|catch/g);
        const returnMatches = code.match(/return/g);

        return {
            cyclomaticComplexity: (branchMatches?.length || 0) + 1,
            maintainabilityIndex: 100,
            linesOfCode: lines.length,
            numberOfFunctions: functionMatches?.length || 0,
            branchCount: branchMatches?.length || 0,
            returnCount: returnMatches?.length || 0,
            maxNestingDepth: 0,
            averageFunctionComplexity: 1,
            functionMetrics: []
        };
    }

    private parseSecurityOutput(output: string, tool: string): SecurityIssue[] {
        switch (tool) {
            case 'bandit':
                return this.parseBanditOutput(output);
            case 'eslint':
                return this.parseEslintOutput(output);
            default:
                return [];
        }
    }

    private parseStyleOutput(output: string, tool: string): StyleViolation[] {
        switch (tool) {
            case 'pylint':
                return this.parsePylintOutput(output);
            case 'eslint':
                return this.parseEslintOutput(output).map(issue => ({
                    rule: issue.type,
                    message: issue.description,
                    line: issue.line || 0,
                    column: issue.column || 0
                }));
            default:
                return [];
        }
    }

    private parseComplexityOutput(output: string, tool: string): ComplexityMetrics {
        switch (tool) {
            case 'radon':
                try {
                    const results = JSON.parse(output);
                    const totalComplexity = Object.values(results).reduce((sum: number, file: any) => {
                        return sum + file.complexity;
                    }, 0);

                    return {
                        cyclomaticComplexity: totalComplexity,
                        maintainabilityIndex: 100 - (totalComplexity * 5),
                        linesOfCode: 0,
                        numberOfFunctions: Object.keys(results).length,
                        branchCount: 0,
                        returnCount: 0,
                        maxNestingDepth: 0,
                        averageFunctionComplexity: totalComplexity / Object.keys(results).length,
                        functionMetrics: []
                    };
                } catch {
                    return this.getDefaultComplexityMetrics('');
                }
            case 'gocyclo':
                try {
                    const lines = output.split('\n').filter(Boolean);
                    const metrics = lines.map(line => {
                        const [complexity, path, name] = line.split(' ');
                        return {
                            name,
                            complexity: parseInt(complexity, 10),
                            startLine: 0,
                            endLine: 0,
                            parameterCount: 0,
                            returnCount: 0,
                            localVariables: 0,
                            nestingDepth: 0
                        };
                    });

                    const totalComplexity = metrics.reduce((sum, m) => sum + m.complexity, 0);
                    return {
                        cyclomaticComplexity: totalComplexity,
                        maintainabilityIndex: this.calculateMaintainabilityIndex(totalComplexity, 0),
                        linesOfCode: 0,
                        numberOfFunctions: metrics.length,
                        branchCount: 0,
                        returnCount: 0,
                        maxNestingDepth: 0,
                        averageFunctionComplexity: totalComplexity / metrics.length,
                        functionMetrics: metrics
                    };
                } catch {
                    return this.getDefaultComplexityMetrics('');
                }
            default:
                return this.getDefaultComplexityMetrics('');
        }
    }

    private parseBanditOutput(output: string): SecurityIssue[] {
        try {
            const results = JSON.parse(output);
            return results.results.map((result: any) => ({
                type: result.test_id,
                severity: result.issue_severity,
                description: result.issue_text,
                line: result.line_number
            }));
        } catch {
            return [];
        }
    }

    private parsePylintOutput(output: string): StyleViolation[] {
        try {
            const results = JSON.parse(output);
            return results.map((result: any) => ({
                rule: result.symbol,
                message: result.message,
                line: result.line,
                column: result.column
            }));
        } catch {
            return [];
        }
    }

    private parseEslintOutput(output: string): SecurityIssue[] {
        try {
            const results = JSON.parse(output);
            return results.map((result: {
                ruleId: string;
                severity: number;
                message: string;
                line: number;
                column: number;
            }) => ({
                type: result.ruleId,
                severity: result.severity === 2 ? 'high' : result.severity === 1 ? 'medium' : 'low',
                description: result.message,
                line: result.line,
                column: result.column
            }));
        } catch {
            return [];
        }
    }
}
