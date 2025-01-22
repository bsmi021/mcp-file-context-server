import { promises as fs } from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as parser from '@typescript-eslint/parser';
import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/types';
import { FileContent } from '../types.js';

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

export interface CodeAnalysisResult {
    security_issues: SecurityIssue[];
    style_violations: StyleViolation[];
    complexity_metrics: ComplexityMetrics;
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

    constructor() {
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

    public async analyzeCode(code: string, language: string): Promise<CodeAnalysisResult> {
        const config = this.languageConfigs[language.toLowerCase()];
        if (!config) {
            throw new Error(`Unsupported language: ${language}`);
        }

        const tempFile = path.join(this.tempDir, `analysis_${Date.now()}${config.extensions[0]}`);
        await fs.writeFile(tempFile, code);

        try {
            let complexityMetrics: ComplexityMetrics;
            if (config.parser) {
                // Use AST-based analysis for supported languages
                const ast = config.parser(code);
                complexityMetrics = this.analyzeAst(ast);
            } else if (config.complexityTool) {
                // Fall back to external tools
                const { stdout } = await execAsync(`${config.complexityTool} ${tempFile}`);
                complexityMetrics = this.parseComplexityOutput(stdout, config.complexityTool);
            } else {
                // Basic analysis for unsupported languages
                complexityMetrics = this.getDefaultComplexityMetrics(code);
            }

            const [securityIssues, styleViolations] = await Promise.all([
                this.runSecurityAnalysis(tempFile, config),
                this.runStyleAnalysis(tempFile, config)
            ]);

            return {
                security_issues: securityIssues,
                style_violations: styleViolations,
                complexity_metrics: complexityMetrics
            };
        } finally {
            await fs.unlink(tempFile).catch(() => { });
        }
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
            console.error('Security analysis failed:', error);
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
            console.error('Style analysis failed:', error);
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

    public async generateOutline(content: FileContent): Promise<string> {
        const analysis = await this.analyzeCode(content.content, path.extname(content.path).slice(1));
        const parts: string[] = [];

        // Add file info
        parts.push(`File: ${path.basename(content.path)}`);

        // Add complexity metrics
        if (analysis.complexity_metrics) {
            parts.push('\nComplexity Metrics:');
            parts.push(`  Lines of Code: ${analysis.complexity_metrics.linesOfCode}`);
            parts.push(`  Cyclomatic Complexity: ${analysis.complexity_metrics.cyclomaticComplexity}`);
            parts.push(`  Maintainability Index: ${analysis.complexity_metrics.maintainabilityIndex}`);

            if (analysis.complexity_metrics.functionMetrics.length > 0) {
                parts.push('\nFunctions:');
                analysis.complexity_metrics.functionMetrics.forEach(fn => {
                    parts.push(`  ${fn.name}:`);
                    parts.push(`    Lines: ${fn.startLine}-${fn.endLine}`);
                    parts.push(`    Complexity: ${fn.complexity}`);
                    parts.push(`    Parameters: ${fn.parameterCount}`);
                });
            }
        }

        // Add security issues
        if (analysis.security_issues.length > 0) {
            parts.push('\nSecurity Issues:');
            analysis.security_issues.forEach(issue => {
                parts.push(`  [${issue.severity.toUpperCase()}] ${issue.type}`);
                if (issue.line) {
                    parts.push(`    Line ${issue.line}: ${issue.description}`);
                }
            });
        }

        // Add style violations
        if (analysis.style_violations.length > 0) {
            parts.push('\nStyle Issues:');
            analysis.style_violations.forEach(violation => {
                parts.push(`  Line ${violation.line}: ${violation.message}`);
            });
        }

        return parts.join('\n');
    }
}
