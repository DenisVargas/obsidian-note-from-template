import {  TFolder, Editor } from 'obsidian';
/*
 * This file contains common objects used by the whole templating system
 */

/*
 * Shared definitions/constants
 */
export const BAD_CHARS_FOR_FILENAMES_TEXT = ":[]?/\\"
export const BAD_CHARS_FOR_FILENAMES_MATCH = /[:[\]?/\\]/g
export const BAD_CHARS_FOR_PATHS_MATCH = /[:[\]?\\]/g

// Which are the YAML fields used by the template system
export const TEMPLATE_FIELDS = [
    "template-id",
    "template-name",
    "template-replacement",
    "template-input",
    "template-output",
    "template-filename",
    "template-should-replace",
    "template-should-create"
]

export type ReplaceType = "always" | "sometimes" | "never"
export type CreateType = "none" | "create" | "open" | "open-pane" | "open-tab"
/*
 * This defines whether a template should replace things in the Editor
 * (feels a bit redundant? also, why does it have Editor in?)
 */
export interface ReplacementOptions {
	editor?:Editor;
	shouldReplaceSelection:ReplaceType
	shouldCreateOpen:CreateType
	willReplaceSelection:boolean;
}

/*
 * Identifies the template in the vault - used to create the command for it
 * These can only be updated by reloading the plugin at the moment
 */
export interface TemplateMetadata {
	id: string; //Unique ID for building commands, based on template filename
	name: string; //Name to show for the command (probably same as the template filename, but doesn't have to be)
	path: string; //Path of the template file
}

/*
 * Settings for what the template should do when activated
 */
export interface iFT_TemplateExecutionSettings {
    /**
     * Defines whether the selected editor text should be replaced with the generated replacement text.
     *
     * - "always": replace selection even if empty/implicit.
     * - "sometimes": replace only when there is meaningful selected input.
     * - "never": do not replace selection.
     */
	selectionReplacementPolicy: ReplaceType;
    /**
     * Controls whether a note should be created/opened and where it opens.
     *
     * - "none": do not create file.
     * - "create": create file only.
     * - "open": create and open in current leaf.
     * - "open-pane": create and open in split pane.
     * - "open-tab": create and open in new tab.
     */
	outputNoteHandling: CreateType;
    /**
     * Destination folder path (vault-relative) where generated notes should be written.
     * This value can come from plugin defaults or be overridden per template.
     */
    outputDirectoryPath:string;
    /**
     * Comma-separated list of field ids used to map user/editor input into template data.
     * Example: "title,body,tags".
     */
    inputFieldSpec:string;
    /**
     * Candidate replacement string templates used for editor selection replacement.
     * The first item is typically the default replacement option.
     */
    selectionReplacementTemplates:string[]; //TODO: Candidato a eliminar.
    /**
     * Filename template used to derive the final output note name.
     * Usually contains placeholders resolved during rendering, e.g. "{{title}}".
     */
    outputFilenameTemplate:string;
}

export interface iFT_PluginSettings extends iFT_TemplateExecutionSettings {
    /**
     * Vault-relative path of the folder where template markdown files are stored.
     * Scanned by `loadFromDefaultLocation()` to discover and register available templates.
     * Plugin-specific — not part of {@link iFT_TemplateExecutionSettings}.
     */
    templateDirectoryPath: string;
    /**
     * Regex delimiter used to split the active editor selection into individual field values.
     * Passed to `parseInput()` when mapping raw selection text to template data fields.
     * Plugin-specific — not part of {@link iFT_TemplateExecutionSettings}.
     */
    inputSplitPattern: string;
    /**
     * Reserved configuration string for future plugin-level settings.
     * Plugin-specific — not part of {@link iFT_TemplateExecutionSettings}.
     */
    pluginConfigRaw: string;
    /**
     * Controls whether the input UI shows suggestions when filling template fields.
     * When `true`, the field inputs display autocomplete candidates from the vault.
     * Plugin-specific — not part of {@link iFT_TemplateExecutionSettings}.
     */
    enableInputSuggestions: boolean;
}

/*
 * What we get when we fill out a template
 */
export interface TemplateResult {
    note:string; // The full text of the note including Properties/YAML
    replacementText:string; // The text to replace selected text in the editor with
    filename:string; // The final filename to make the note with
    folder:string; // The full path to write the template to
}

/* -------------------------------------------------------------------------- */
/*             Error Handling via Pattern Matching (more explicit)            */
/* -------------------------------------------------------------------------- */

export type Ok<T> = {
    ok:true
    value:T
}

export type Err<E extends Error> = {
    ok:false
    error:E
}

export type Result<T, E extends Error> = Ok<T> | Err<E>

export const Ok = <T>(value:T): Ok<T> => ({ok:true, value})
export const Err = <E extends Error>(error:E): Err<E> => ({ok:false, error})

/*
 * A particular field from a template
 */
export interface TemplateField {
	id: string //Unique id, first bit of the field
	inputType: string // What kind of input is it?
	args: string[]
	alternatives: string[]
    description: string 
}

/*
 * All of the information required to fill out a template with data.
 * Extends iFT_TemplateExecutionSettings so that the effective action settings (merged from global
 * defaults and per-template overrides) travel with the template at execution time.
 */
export interface ActiveTemplate extends iFT_TemplateExecutionSettings {
    /** The currently selected text in the editor at the moment the template was launched. */
    editorSelection: string;
    /** Identifies the template (id, name, vault path) — used to register/invoke the command. */
    templateMetadata: TemplateMetadata;
    /** Raw markdown body of the template file (everything after the frontmatter). */
    templateFileContent: string;
    /** Parsed YAML frontmatter of the template file as a key-value map. */
    templateProperties: Record<string, unknown>;
    /** Ordered list of fields declared in the template, used to build the input UI. */
    fields: TemplateField[]; //TODO: Esto tiene que reemplazarse.
    /** Handlebars template string for replacing the active editor selection on submit. */
    textReplacement_Pattern: string;
    /** Map of field id → current value, populated progressively as the user fills the form. */
    textReplacement_data: Record<string, string>;
}

/*
 * Just produced in response to scanning for templates? Perhaps?
 */
export interface TemplateFolderSpec {
    location:TFolder
    depth:number
    numTemplates:number
}

/* -------------------------------------------------------------------------- */
/*                                   Events                                   */
/* -------------------------------------------------------------------------- */

/** Typed ids for plugin-local DOM events used by the template workflow. */
export enum FT_DomEventId {
    ExecuteTemplate = "FT_executeTemplate",
    TemplateModalClose = "FT_templateModalClose",
}

/**
 * Event payload emitted when a template is submitted for execution.
 * Carries all context needed to invoke `TemplateProcessor.executeTemplateById()` and process the template.
 */
export type TemplateSubmitEvent = {
    readonly activeTemplate: ActiveTemplate;
    readonly replacementOptions: ReplacementOptions;
    // Direct access to values needed for executeTemplateById
    readonly templateId: string;
    readonly inputData: Record<string, string>;
};

/** Typed DOM custom event carrying a {@link TemplateSubmitEvent} payload in `detail`. */
export type TemplateSubmitDomEvent = CustomEvent<TemplateSubmitEvent>;

/**
 * Event payload emitted when the template input modal is closed.
 */
export type TemplateModalCloseEvent = {
    readonly success: boolean;
    readonly error?: Error;
};

/** Typed DOM custom event carrying a {@link TemplateModalCloseEvent} payload in `detail`. */
export type TemplateModalCloseDomEvent = CustomEvent<TemplateModalCloseEvent>;

export type FT_DomEventDetailMap = {
    [FT_DomEventId.ExecuteTemplate]: TemplateSubmitEvent;
    [FT_DomEventId.TemplateModalClose]: TemplateModalCloseEvent;
};

declare global {
    interface HTMLElementEventMap {
        [FT_DomEventId.ExecuteTemplate]: TemplateSubmitDomEvent;
        [FT_DomEventId.TemplateModalClose]: TemplateModalCloseDomEvent;
    }
}
