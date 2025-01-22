import { promises as fs } from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';

type CompiledTemplate = ReturnType<typeof Handlebars.compile>;

interface TemplateMap {
    context: string;
    files: string;
    highlights: string;
    prompt: string;
}

const DEFAULT_TEMPLATES: TemplateMap = {
    context: `{{#if prompt}}
{{{prompt}}}
{{/if}}
{{#if project_notes}}
{{{project_notes}}}
{{/if}}
{{#if user_notes}}
{{{user_notes}}}
{{/if}}
# Repository Content: **{{project_name}}**

> 🕒 Generation timestamp: {{timestamp}}  
> 📝 Use \`lc-list-modified-files\` to track changes since generation

{{#if sample_requested_files}}
## 📂 File Access Guide

Files in the repository structure are marked as:
- ✓ Full content available
- ○ Outline available
- ✗ Excluded/not loaded

To retrieve missing files, use the \`lc-get-files\` tool:
\`\`\`json
{
  "path": "{{project_root}}",
  "files": ["path/to/file"]
}
\`\`\`
{{/if}}

## 📁 Repository Structure
\`\`\`
{{{folder_structure_diagram}}}
\`\`\`

{{#if files}}
## 📄 Current Files
{{> files}}
{{/if}}

{{#if highlights}}
## 🔍 Code Outlines
{{> highlights}}
{{/if}}

## 🔄 Next Steps
1. Use \`lc-list-modified-files\` to check for changes
2. Request specific files with \`lc-get-files\`
3. Search code with \`search_context\``,

    files: `{{#each files}}
### 📄 {{path}}
{{#if metadata.analysis}}
> 📊 Complexity: {{metadata.analysis.complexity}} | 🔗 Dependencies: {{metadata.analysis.imports.length}}
{{/if}}

\`\`\`{{language}}
{{{content}}}
\`\`\`

{{/each}}`,

    highlights: `{{#each highlights}}
### 🔍 {{path}}
{{#if metadata.analysis}}
> 📊 Complexity: {{metadata.analysis.complexity}}
{{/if}}

\`\`\`
{{{outline}}}
\`\`\`

{{/each}}`,

    prompt: `# LLM Analysis Guide

## 🎯 Role
Expert code analyst and developer focusing on understanding and improving the codebase.

## 📋 Guidelines
1. 🔍 Analyze context before suggesting changes
2. 🔗 Consider dependencies and side effects
3. 📝 Follow project's code style
4. ⚠️ Preserve existing functionality
5. 📚 Document significant changes
6. 🛡️ Handle errors gracefully

## 💡 Response Structure
1. Acknowledge files/code being analyzed
2. Explain current implementation
3. Present suggestions clearly
4. Highlight potential impacts
5. Provide rationale for decisions

## 🎨 Code Style
- Match existing conventions
- Use consistent formatting
- Choose clear names
- Add helpful comments

## 🔒 Security
- Protect sensitive data
- Validate inputs
- Handle errors securely
- Follow best practices

## ⚡ Performance
- Consider efficiency
- Note performance impacts
- Suggest optimizations

Remember to balance ideal solutions with practical constraints.`
};

export class TemplateService {
    private templates: Map<string, CompiledTemplate>;
    private projectRoot: string;
    private templatesDir: string;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.templatesDir = path.join(projectRoot, '.llm-context', 'templates');
        this.templates = new Map();
    }

    public async initialize(): Promise<void> {
        // Create templates directory if it doesn't exist
        await fs.mkdir(this.templatesDir, { recursive: true });

        // Initialize default templates if they don't exist
        for (const [name, content] of Object.entries(DEFAULT_TEMPLATES)) {
            const templatePath = path.join(this.templatesDir, `${name}.hbs`);
            if (!await this.fileExists(templatePath)) {
                await fs.writeFile(templatePath, content);
            }
        }

        // Load all templates
        await this.loadTemplates();
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    private async loadTemplates(): Promise<void> {
        // Register partials first
        const filesContent = await this.readTemplate('files');
        const highlightsContent = await this.readTemplate('highlights');
        Handlebars.registerPartial('files', filesContent);
        Handlebars.registerPartial('highlights', highlightsContent);

        // Compile and cache templates
        for (const name of Object.keys(DEFAULT_TEMPLATES)) {
            const content = await this.readTemplate(name as keyof TemplateMap);
            this.templates.set(name, Handlebars.compile(content));
        }
    }

    private async readTemplate(name: keyof TemplateMap): Promise<string> {
        const templatePath = path.join(this.templatesDir, `${name}.hbs`);
        try {
            return await fs.readFile(templatePath, 'utf8');
        } catch (error) {
            console.error(`Error reading template ${name}:`, error);
            return DEFAULT_TEMPLATES[name];
        }
    }

    public async render(templateName: string, context: any): Promise<string> {
        const template = this.templates.get(templateName);
        if (!template) {
            throw new Error(`Template '${templateName}' not found`);
        }

        try {
            return template(context);
        } catch (error) {
            console.error(`Error rendering template ${templateName}:`, error);
            throw error;
        }
    }

    public async getPrompt(): Promise<string> {
        return this.render('prompt', {});
    }
} 