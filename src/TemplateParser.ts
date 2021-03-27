import { App, EditorPosition, MarkdownView, TFile } from "obsidian";
import * as nunjucks from "nunjucks";

import { InternalTemplateParser } from "./InternalTemplates/InternalTemplateParser";
import TemplaterPlugin from "./main";
import { UserTemplateParser } from "./UserTemplates/UserTemplateParser";

const TP_CURSOR = "{{tp.cursor}}";

export abstract class Parser {
    constructor(public app: App) {}
    abstract generateContext(file: TFile): Promise<any>;
}

export class TemplateParser extends Parser {
    public internalTemplateParser: InternalTemplateParser;
	public userTemplateParser: UserTemplateParser;
    env: nunjucks.Environment;
    
    constructor(app: App, plugin: TemplaterPlugin) {
        super(app);
        this.internalTemplateParser = new InternalTemplateParser(this.app);
        this.userTemplateParser = UserTemplateParser.createUserTemplateParser(this.app, plugin, this);

        this.env = nunjucks.configure({
            web: {
                async: true,
            }
        })
    }

    async generateContext(file: TFile) {
        let internal_context = await this.internalTemplateParser.generateContext(file);
        let user_context = {};
        if (this.userTemplateParser) {
            user_context = await this.userTemplateParser.generateContext(file);
        }

        return {
            tp: {
                ...internal_context,
                user: {
                    ...user_context
                }
            }
        }
    }

    async parseTemplates(content: string, file: TFile) {
        let context = await this.generateContext(file);

        console.log("GLOBAL_CONTEXT:", context);
        content = await this.env.renderString(content, context);

        return content;
    }

    async replace_templates_and_append(template_file: TFile) {
        let active_view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (active_view === null) {
            throw new Error("Templater: No active view, can't append templates.");
        }

        let editor = active_view.editor
        let doc = editor.getDoc();

        let content = await this.app.vault.read(template_file);
        content = await this.parseTemplates(content, active_view.file);
        
        doc.replaceSelection(content);
        await active_view.save();

        this.jump_to_next_cursor_location();
        editor.focus();
    }

    async replace_templates_and_overwrite_in_file(file: TFile) {
        let content = await this.app.vault.read(file);

        let new_content = await this.parseTemplates(content, file);
        if (new_content !== content) {
            await this.app.vault.modify(file, new_content);
            
            if (this.app.workspace.getActiveFile() === file) {
                await this.jump_to_next_cursor_location();
            }
        }
    }

    async jump_to_next_cursor_location() {
        let active_file = this.app.workspace.getActiveFile();
        if (!active_file) {
            return;
        }

        let content = await this.app.vault.read(active_file);
        let pos = this.get_cursor_position(content);
        if (pos) {
            content = content.replace(new RegExp(TP_CURSOR), "");
            this.set_cursor_location(pos);
            await this.app.vault.modify(active_file, content);
        }
    }

    get_cursor_position(content: string): EditorPosition {
        let pos: EditorPosition = null;
        let index = content.indexOf(TP_CURSOR);

        if (index !== -1) {
            let substr = content.substr(0, index);

            let l = 0;
            let offset = -1;
            let r = -1;
            for (; (r = substr.indexOf("\n", r+1)) !== -1 ; l++, offset=r);
            offset += 1;

            let ch = content.substr(offset, index-offset).length;

            pos = {line: l, ch: ch};
        }
        return pos;
    }

    set_cursor_location(pos: EditorPosition) {
        if (!pos) {
            return;
        }

        let active_view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (active_view === null) {
            return;
        }
        let editor = active_view.editor;

        editor.focus();
        // TODO: Replace with setCursor in next release
        editor.setSelection(pos);
    }
}