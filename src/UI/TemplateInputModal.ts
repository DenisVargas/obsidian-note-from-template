/**
 * Template input modal for collecting user data before template execution.
 * Builds a fluent UI using the builder pattern for dynamic field rendering.
 */

import { Modal, Setting, ButtonComponent, TextComponent, TextAreaComponent, ToggleComponent, DropdownComponent } from 'obsidian';
import FT_Plugin from '../main.js';
import {
    BAD_CHARS_FOR_FILENAMES_MATCH,
    BAD_CHARS_FOR_FILENAMES_TEXT,
    FT_DomEventId,
    type FT_DomEventDetailMap,
    type ActiveTemplate,
    type CreateType,
    type ReplacementOptions,
    type TemplateField,
} from '../Shared.js';
import { DateTime } from "luxon";
import { LinkSuggest, TagSuggest, TemplateStatusView } from './utils.js';
import type { SubcontrolParams } from './types.js';
import { capitalize } from '../utils.js';

class TemplateInputBuilder {
    private readonly root: HTMLElement;
    private readonly status: TemplateStatusView;

    constructor(
        private readonly modal: TemplateInputModal,
        private readonly activeTemplate: ActiveTemplate,
        private readonly options: ReplacementOptions,
    ) {
        this.root = modal.contentEl;
        this.status = new TemplateStatusView(modal.modalEl, this.root);
    }

    addHeader(): this {
        this.modal.modalEl.addClass("from-template-modal");
        this.modal.titleEl.createEl('h4', { text: "Create from Template", cls: "from-template-title" });
        return this;
    }

    addBody(): this {
        this.status.setNeutral();
        return this;
    }

    addInfoSection(): this {
        this.modal.makeSubcontrol(this.root, {
            title: "Template",
            content: `${this.activeTemplate.templateMetadata.name}`,
            rowCls: ["from-template-control-row-minimal-space"],
        });

        this.modal.makeSubcontrol(this.root, {
            title: "Destination",
            content: `${this.activeTemplate.outputDirectoryPath}/${this.activeTemplate.outputFilenameTemplate}.md`,
            contentCls: ["from-template-code-span"],
            rowCls: ["from-template-control-row-minimal-space"],
            keyDisplay: "⌘+",
        });

        this.addSeparator();
        return this;
    }

    addFieldsSection(): this {
        const setValue = (id: string, value: string) => {
            this.activeTemplate.textReplacement_data[id] = value;
            this.status.setNeutral();
        };

        console.debug("Fields", this.activeTemplate.fields);
        this.activeTemplate.fields.forEach((field, index) => {
            this.modal.createInput(this.root, this.activeTemplate.textReplacement_data, field, setValue, index);
        });

        return this;
    }

    private addReplacementSection(): this {
        const computeWillReplaceSelection = (): boolean => {
            if (this.options.shouldReplaceSelection === "always") return true;
            if (this.options.shouldReplaceSelection === "sometimes" && this.activeTemplate.editorSelection.length > 0) return true;
            return false;
        };

        this.options.willReplaceSelection = computeWillReplaceSelection();

        new Setting(this.root.createDiv({ cls: "from-template-control-row-undivided" }))
            .setName("Replace selected text")
            .addToggle((toggle) => toggle
                .setValue(this.options.willReplaceSelection)
                .onChange((value) => {
                    this.options.willReplaceSelection = value;
                    replacementText.setDisabled(!value);
                }));

        const replacementContainer = this.modal.makeSubcontrol(this.root, { title: "Replacement" });
        const replacementText = new TextComponent(replacementContainer)
            .setValue(this.activeTemplate.textReplacement_Pattern)
            .onChange((value) => {
                this.activeTemplate.textReplacement_Pattern = value;
            })
            .setDisabled(!this.options.willReplaceSelection);

        replacementText.inputEl.addClass("from-template-subcontrol");

        const fieldNames = this.activeTemplate.fields.map((field) => field.id);
        fieldNames.push("templateResult");

        const availableFields = this.modal.makeSubcontrol(this.root, {
            title: "Available fields",
            description: "for replacement string",
        });

        fieldNames.forEach((fieldName) => {
            const button = availableFields.createEl("button", {
                text: fieldName,
                cls: ["from-template-inline-code-button"],
            });
            button.onClickEvent(() => {
                replacementText.setValue(replacementText.getValue() + `{{${fieldName}}}`);
                this.activeTemplate.textReplacement_Pattern = replacementText.getValue();
            });
        });

        const alternatives = this.modal.makeSubcontrol(this.root, {
            title: "Replacements",
            description: "specified in the template",
            keyDisplay: "^+",
        });

        this.activeTemplate.selectionReplacementTemplates.forEach((replacementValue, index) => {
            const button = new ButtonComponent(alternatives)
                .setButtonText(`${index + 1}: ${replacementValue}`)
                .onClick(() => {
                    replacementText.setValue(replacementValue);
                    this.activeTemplate.textReplacement_Pattern = replacementValue;
                }).buttonEl;

            button.addClass("from-template-inline-code-button");
            button.tabIndex = -1;
            this.modal.scope.register(["Ctrl"], `${index + 1}`, () => {
                replacementText.setValue(replacementValue);
                this.activeTemplate.textReplacement_Pattern = replacementValue;
            });
        });

        return this;
    }

    private addCreateOpenSection(): this {
        this.addSeparator();

        new Setting(this.root.createDiv({ cls: "from-template-control-row-undivided" }))
            .setName("Create and open note")
            .setDesc("Should the note be created / opened?")
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("none", "Don't create")
                    .addOption("create", "Create, but don't open")
                    .addOption("open", "Create and open")
                    .addOption("open-pane", "Create and open in new pane")
                    .addOption("open-tab", "Create and open in new tab")
                    .setValue(this.options.shouldCreateOpen)
                    .onChange((value) => {
                        this.options.shouldCreateOpen = value as CreateType;
                    });
            });

        return this;
    }

    addSubmitSection(): this {
        this.addSeparator();

        this.modal.renderSubmitSection(this.root, async () => {
            try {
                this.modal.emit(FT_DomEventId.ExecuteTemplate, {
                    activeTemplate: this.activeTemplate,
                    replacementOptions: this.options,
                    templateId: this.activeTemplate.templateMetadata.id,
                    inputData: { ...this.activeTemplate.textReplacement_data },
                });
                this.modal.markSubmitSucceeded();
                this.modal.close();
            } catch (error) {
                console.debug("Unhandled error dispatching template event", error);
                this.status.setError(error instanceof Error ? error.message : String(error));
            }
        });
        return this;
    }

    render(): void {
        this
            .addHeader()
            .addBody()
            .addInfoSection()
            .addFieldsSection()
            .addReplacementSection()
            .addCreateOpenSection()
            .addSubmitSection();
    }

    private addSeparator(): void {
        this.root.createEl("hr", { cls: "from-template-section-sep" });
    }
}

/**
 * Modal dialog that collects user input for filling out a template before writing the generated note.
 *
 * Opened via {@link openWith} with an {@link ActiveTemplate} (containing the compiled template,
 * its metadata, and the pre-populated data record) and {@link ReplacementOptions} (controlling
 * whether/how the active editor selection is replaced).
 *
 * Responsibilities:
 * - Renders one input control per template field, based on its `inputType` (text, area, choice, etc.).
 * - Manages the replacement-text toggle and lets the user pick from pre-defined replacement strings.
 * - Exposes a "Create and open" dropdown to override the note creation behaviour at submit time.
 * - Emits typed events for template submission and modal closure.
 */
export class TemplateInputModal extends Modal {
    plugin: FT_Plugin;

    private _activeTemplate: ActiveTemplate | undefined;
    private _options: ReplacementOptions | undefined;
    private _submitSucceeded = false;

    constructor(plugin: FT_Plugin) {
        super(plugin.app);
        this.plugin = plugin;
    }

    openWith(template: ActiveTemplate, options: ReplacementOptions): void {
        this._activeTemplate = template;
        this._options = options;
        this._submitSucceeded = false;
        super.open();
    }

    emit<K extends FT_DomEventId>(id: K, detail: FT_DomEventDetailMap[K]): void {
        this.plugin.eventBus.dispatchEvent(new CustomEvent(id, { detail }));
    }

    renderSubmitSection(root: HTMLElement, submitTemplate: () => Promise<void>): void {
        const addDiv = root.createDiv({ cls: "from-template-control-row" });
        addDiv.createDiv({ cls: "from-template-description-column" });
        addDiv.createDiv({ cls: "from-template-control-column" })
            .createEl('button', { text: "Add", cls: "from-template-submit" })
            .addEventListener("click", () => {
                void submitTemplate();
            });
        addDiv.createDiv({ cls: "from-template-key-column" })
            .createDiv({ text: "↩", cls: "from-template-shortkey" });
        this.scope.register(['Mod'], "enter", () => {
            void submitTemplate();
        });
    }

    private renderForTemplate(activeTemplate: ActiveTemplate, options: ReplacementOptions): void {
        new TemplateInputBuilder(this, activeTemplate, options).render();
    }

    async onOpen() {
        const activeTemplate = this._activeTemplate;
        const options = this._options;

        if (options && activeTemplate) {
            this.renderForTemplate(activeTemplate, options);
        }
        else {
            console.error(`Options is ${options} and template is ${activeTemplate}`);
        }
    }

    onClose() {
        const { contentEl, titleEl } = this;

        this.emit(FT_DomEventId.TemplateModalClose, { success: this._submitSucceeded });

        titleEl.empty();
        contentEl.empty();
        this._activeTemplate = undefined;
        this._options = undefined;
        this._submitSucceeded = false;
    }

    markSubmitSucceeded(): void {
        this._submitSucceeded = true;
    }

    makeSubcontrol(el: HTMLElement, params: SubcontrolParams): HTMLElement {
        const { title, content, description, labelCls = [], contentCls = [], rowCls = [], keyDisplay } = params;
        const sc = el.createDiv({ cls: ["from-template-control-row", ...rowCls] });
        const label = sc.createDiv({ cls: "from-template-description-column" });
        label.createDiv({ text: `${title}:`, cls: ["from-template-sublabel", ...labelCls] });
        if (description) label.createDiv({ text: description, cls: ["from-template-label-description", ...labelCls] });
        const contr = sc.createDiv({ cls: "from-template-control-column" });
        if (content)
            contr.createSpan({ text: `${content}`, cls: ["from-template-subcontrol", ...contentCls] });
        if (keyDisplay) {
            const key = sc.createDiv({ cls: "from-template-key-column" });
            key.createDiv({ text: keyDisplay, cls: "from-template-shortkey" });
        }

        return contr;
    }

    createInput(parent: HTMLElement, data: Record<string, string>, field: TemplateField, setTemplateValue: (k: string, v: any) => void, index: number = -1, initial: string = "") {
        const id = field.id;

        if (id === "currentTitle") return;
        if (id === "currentPath") return;

        const controlEl = parent.createEl('div', { cls: "from-template-control-row" });
        const labelContainer = controlEl.createEl("label", { cls: "from-template-description-column" });
        labelContainer.createEl("label", { text: `${capitalize(field.id)}`, cls: "from-template-label-text" });
        if (field.description && field.description.length > 0)
            labelContainer.createDiv({ text: field.description, cls: "from-template-label-description" });
        labelContainer.htmlFor = id;

        const controlWrapper = controlEl.createEl('div', { cls: "from-template-control-column" });

        const element = this.createInputControl(controlWrapper, data, field, setTemplateValue, index, initial);
        const keyEl = controlEl.createEl('div', { cls: "from-template-key-column" });

        if (element) {
            if (index === 0) element.focus();
            element.addClass("from-template-control");
            if (index <= 8) {
                this.scope.register(["Mod"], `${index + 1}`, () => element.focus());
                keyEl.createEl("div", { text: `${index + 1}`, cls: "from-template-shortkey" });
            }
        }
    }

    createInputControl(
        controlEl: HTMLElement,
        data: Record<string, string>,
        field: TemplateField,
        setTemplateValue: (k: string, v: any) => void,
        index: number = -1,
        initial: string = ""
    ): HTMLElement {
        const id = field.id;
        const inputType = field.inputType;

        if (initial) data[field.id] = initial;

        let textEl: HTMLElement = new HTMLElement();

        switch (inputType) {
            case "area": {
                console.debug(field);
                const textAreaEl = new TextAreaComponent(controlEl)
                    .setValue(data[id])
                    .onChange((value) => setTemplateValue(id, value));
                textAreaEl.inputEl.rows = 5;
                return textAreaEl.inputEl;
            }

            case "text": {
                console.debug(field);
                const initial = data[id] || (field.args.length ? field.args[0] : "");
                const cb = (value: string) => setTemplateValue(id, value);
                const textComponent = new TextComponent(controlEl)
                    .setValue(initial)
                    .onChange(cb);
                textComponent.inputEl.size = 50;
                textEl = textComponent.inputEl;
                if (this.plugin.settings?.enableInputSuggestions) {
                    if (id === "tags") new TagSuggest(textEl as HTMLInputElement, this.app, cb);
                    else new LinkSuggest(textEl as HTMLInputElement, this.app, cb);
                }
                return textEl;
            }

            case "note-title": {
                console.debug(field);
                const initial = data[id] || (field.args.length ? field.args[0] : "");
                const initial_safe = initial.replace(BAD_CHARS_FOR_FILENAMES_MATCH, "");
                data[id] = initial_safe;
                const error = controlEl.createEl("div", { text: "Error! Characters not allowed in filenames: " + BAD_CHARS_FOR_FILENAMES_TEXT, cls: "from-template-error-text" });
                const updateError = (v: string) => {
                    if (v.match(BAD_CHARS_FOR_FILENAMES_MATCH)) error.removeAttribute("hidden");
                    else error.setAttribute("hidden", "true");
                };
                updateError(initial_safe);
                const textComponent = new TextComponent(controlEl)
                    .setValue(initial_safe)
                    .onChange((value) => { setTemplateValue(id, value); updateError(value) });
                textComponent.inputEl.size = 50;
                return textComponent.inputEl;
            }

            case "choice": {
                const opts: Record<string, string> = {};
                field.args.forEach(f => opts[f] = capitalize(f));
                const dropDown = new DropdownComponent(controlEl)
                    .addOptions(opts)
                    .setValue(data[id])
                    .onChange((value) => setTemplateValue(id, value));
                return dropDown.selectEl;
            }

            case "multi": {
                const selected: string[] = [];
                const spanEl = controlEl.createSpan();
                field.args.forEach((f) => {
                    const d = spanEl.createDiv({ text: f });
                    new ToggleComponent(d)
                        .setTooltip(f)
                        .onChange((value) => {
                            if (value) selected.push(f);
                            else selected.remove(f);
                            setTemplateValue(id, selected.join(", "));
                        });
                });
                return spanEl;
            }

            case "currentDate": {
                const fmt = field.args[0] || 'yyyy-MM-dd';
                const cur = DateTime.now().toFormat(fmt);
                data[id] = cur;
                const textEl = new TextComponent(controlEl)
                    .setValue(cur)
                    .onChange((value) => setTemplateValue(id, value));
                textEl.inputEl.size = 50;
                return textEl.inputEl;
            }
        }
        return textEl;
    }
}
