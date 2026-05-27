/*
 * This file contains common objects used by the whole templating system
 */

import { TFolder, Editor } from "obsidian";
import { FT_TemplateProcessor } from "./TemplateProcessing.js";
import { compile } from "handlebars";

/*
 * Shared definitions/constants
 */
export const BAD_CHARS_FOR_FILENAMES_TEXT = ":[]?/\\";
export const BAD_CHARS_FOR_FILENAMES_MATCH = /[:[\]?/\\]/g;
export const BAD_CHARS_FOR_PATHS_MATCH = /[:[\]?\\]/g;

// Which are the YAML fields used by the template system
export const TEMPLATE_FIELDS = [
	"template-id",
	"template-name",
	"template-replacement",
	"template-input",
	"template-output",
	"template-filename",
	"template-should-replace",
	"template-should-create",
	"template-command-name"
];

//* Replaces [shouldReplaceSelection]
export type ReplacementStrategy = "always" | "selected-only" | "never";
export type CreateType = "none" | "create" | "open" | "open-pane" | "open-tab";

//! Deprecated: Included within ExtendedSettings
// /*
//  * This defines whether a template should replace things in the Editor
//  * (feels a bit redundant? also, why does it have Editor in?)
//  */
// export interface ReplacementOptions {
// 	editor?: Editor;
// 	shouldReplaceSelection: ReplaceType;
// 	shouldCreateOpen: CreateType;
// 	willReplaceSelection: boolean;
// }

/**
 * Identifies the template in the vault - used to create the command for it
 * These can only be updated by reloading the plugin at the moment
 */
export interface TemplateMetadata {
	/** Unique ID for building commands, based on template filename */
	id: string;
	/** Name to show for the command (probably same as the template filename, but doesn't have to be) */
	name: string;
	/** Location of the template inside the vault */
	path: string;
}

/*
 * What we get when we fill out a template
 */
export interface TemplateResult {
	filename: string; // The final filename to make the note with
	folder: string; // The full path to write the template to
	note: string; // The full text of the note including Properties/YAML
	replacementText: string; // The text to replace selected text in the editor with
}

/**
 * Describes a single input field declared inside a template.
 * Used to build the input UI and collect user data before template execution.
 *
 * Fields are parsed from the template's `template-input` frontmatter key,
 * following the format: `{{fieldID:fieldType:arg1:arg2|Description text}}`
 *
 * @example
 * // Template source:
 * // {{title:text|Note title}}
 * // {{status:choice:draft:published|Publishing status}}
 * // {{body:area|Main content}}
 * 
 * @see https://github.com/mo-seph/obsidian-note-from-template#field-types
 */
export interface TemplateField {
    [key: string]: string | string[] | undefined;
    /**
     * Unique identifier for this field within the template.
     * First segment of the field declaration. Used as the key in `textReplacement_data`
     * and as the Handlebars variable name in the template body.
     * @example "title", "body", "tags"
     */
    id: string;

    /**
     * Determines which input control is rendered for this field in the modal.
     * @see inputControlType in TemplateInputModal.ts
     * - `"text"` — Single-line text input (default)
     * - `"area"` — Multi-line textarea
     * - `"note-title"` — Text input with filename-safe character validation
     * - `"choice"` — Dropdown with options from {@link args}
     * - `"multi"` — Toggle group with options from {@link args}
     * - `"currentDate"` — Auto-filled with current date, format from {@link args}[0]
     */
    inputType: string;

    /**
     * Human-readable hint displayed below the field label in the input modal.
     * Parsed from the text after `|` in the field declaration.
     * @example "The title of the new note"
     */
    description?: string;

    /**
     * Positional arguments that configure the field's behaviour, depending on `inputType`:
     * - `"text"` / `"note-title"`: args[0] is the default value
     * - `"choice"` / `"multi"`: each arg is an option shown to the user
     * - `"currentDate"`: args[0] is the Luxon format string (e.g. `"yyyy-MM-dd"`)
     */
    args?: string[];

    /**
     * Alternative replacement strings associated with this field.
     * Intended for use in the Source Text Replacement section of the modal.
     * !Currently unused in active code paths.
     */
    alternatives?: string[];
}
export type TemplateRawData = {
	frontmatter: Record<string, any>;
	settings: Record<string, any>;
	body: string;
};
export type HandlebarsCompiledTemplate = ReturnType<typeof compile>;
export type TemplateCacheEntry = {
	/**
	 * Stable identity for the cached template entry.
	 *
	 * This metadata is used to register the command, resolve the template by id,
	 * and keep a human-readable label plus the vault path of the source note.
	 */
	meta: TemplateMetadata;
	/**
	 * Raw parsed contents of the source markdown template.
	 *
	 * This preserves the separated **frontmatter**, **template-scoped settings**, and
	 * **body** text exactly as they were read from the vault so later steps can
	 * inspect or reuse the original template data without reading the file again.
	 */
	rawData: TemplateRawData;
	compiledTemplate: HandlebarsCompiledTemplate;
};

/**
 * Global Settings (displayed on plugins setting tab, same order of apearence)
 */
export interface iFT_PluginSettings {
	/**
	 * Vault-relative path of the folder where template markdown files are stored.
	 * Scanned by `loadFromDefaultLocation()` to discover and register available templates.
	 * Appears in Settings Tab as "Template Directory"
	 */
	templateDirectoryPath: string;
	/**
	 * Defines whether the selected editor text should be replaced with the generated replacement text.
	 *
	 * - "always": replace selection even if empty/implicit.
	 * - "sometimes": replace only when there is meaningful selected input.
	 * - "never": do not replace selection.
	 */
	selectionReplacementPolicy: ReplacementStrategy;
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
	temptativeOutputFolder: string;
	/**
	 * Filename template used to derive the final output note name.
	 * Usually contains placeholders resolved during rendering, e.g. "{{title}}".
	 */
	temptativeFileName: string;

	outputDirectory: string;
	outputFileName: string;

	/**
	 * Candidate replacement string templates used for editor selection replacement.
	 * The first item is typically the default replacement option.
	 */
	selectionReplacementTemplates: string;
	/**
	 * Comma-separated list of field ids used to map user/editor input into template data.
	 * Example: "title,body,tags".
	 */
	rawInputFieldList: string;
	/**
	 * Regex delimiter used to split the active editor selection into individual field values.
	 * Passed to `parseInput()` when mapping raw selection text to template data fields.
	 */
	inputSplitPattern: string;
	/**
	 * Controls whether the input UI shows suggestions when filling template fields.
	 * When `true`, the field inputs display autocomplete candidates from the vault.
	 */
	enableInputSuggestions: boolean;
	/**
	 * Reserved configuration string for future plugin-level settings.
	 */
	pluginConfigRaw: string;
}

/*
 * All of the information required to fill out a template with data.
 * Extends iFT_TemplateExecutionSettings so that the effective action settings (merged from global
 * defaults and per-template overrides) travel with the template at execution time.
 */
export interface iFT_ExecutionSettings extends iFT_PluginSettings {
	
	//! Template specific. Replaced by [TemplateRawData]
	/** Identifies the template (id, name, vault path) — used to register/invoke the command. */
	templateMetadata: TemplateMetadata; //TODO: esto esta suplido tengo entendido.
	/** Raw markdown body of the template file (everything after the frontmatter). */
	templateFileContent: string; // Duplicate of TemplateRawData.body
	/** 
	 * @deprecated use {@link TemplateRawData.frontmatter}
	 * Parsed YAML frontmatter of the template file as a key-value map. 
	 */
	templateProperties: Record<string, unknown>;
	
	/** Ordered list of fields declared in the template, used to build the input UI. */
	fields: Map<string,TemplateField>;

	/** Handlebars template string for replacing the active editor selection on submit. */
	// textReplacement_Pattern: string;
	/** Map of field id → current value, populated progressively as the user fills the form. */
	// textReplacement_data: Record<string, string>; //TODO: replace by input.

	/** Used for text Replacement */
	editorReference: Editor;
	/** The currently selected text in the editor at the moment the template was launched. */
	editorSelection: string;
	//! defaultReplaceStrategy: ReplacementStrategy; collides with [selectionReplacementPolicy]
	//! shouldReplaceSelection: ReplacementStrategy, renamed to [defaultReplaceStrategy]

	isSelectionReplacementEnabled: boolean;
	//! willReplaceSelection: boolean, renamed to [isSelectionReplacementEnabled]

	//! shouldCreateOpen: CreateType, Deprecated: use [outputNoteHandling] instead.
	/** Determines how the [NEW NOTE] will be Handled */
	outputNoteHandling: CreateType;
}

export class ExtendedSettings implements iFT_ExecutionSettings {
	/* ----------------------------- Global Settings ---------------------------- */
	/** 
	 * @inheritDoc
	 * @see iFT_PluginSettings.templateDirectoryPath 
	 */
	templateDirectoryPath: string;
	selectionReplacementPolicy: ReplacementStrategy;
	outputNoteHandling: CreateType;
	/**
	 * @inheritdoc
	 * This is part of input stage, points to the template-setted target directory.
	 * Does not includes name or extention.
	 */
	temptativeOutputFolder: string;
	/**
	 * @inheritdoc
	 * This filename is treated as a valid Template to be resolved at input stage.
	 * Does not includes extention.
	 */
	temptativeFileName: string;
	outputDirectory: string;
	outputFileName: string;
	/** 
	 * **Source File Replacement**
	 *
	 * This value comes from Globalsettings.
	 * Should be a String with comma separated values.
	 * 
	 * OverWritten by "template-replacement" if defined inside template.
	 * 
	 * @example
	 * "{{title}}, {{url}}, {{date}}"
	 * 
	 * @default "{{title}}"
	 */
	selectionReplacementTemplates: string;
	/** @inheritdoc */
	rawInputFieldList: string;
	/** @inheritdoc */
	inputSplitPattern: string;
	/** @inheritdoc */
	enableInputSuggestions: boolean; //! Currently disabled.
	/** @inheritdoc */
	pluginConfigRaw: string;

	/* --------------------------- Extended Properties -------------------------- */
	/** @inheritDoc */
	editorReference: Editor;
	/** @inheritDoc */
	editorSelection: string;
	/** @inheritdoc */
	templateMetadata: TemplateMetadata;
	/** @inheritdoc */
	templateFileContent: string;
	/** @inheritdoc */
	templateProperties: Record<string, unknown>; //!Deprecated: Look for original declaration.
	/** @inheritdoc */
	textReplacement_Pattern: string;

	/**
	 * Parsed fields extracted from {@link rawInputFieldList}
	 */
	fields: Map<string, TemplateField>;
	/**
	 * Consumed by UI to display an Input per field as Record<string,string>
	 */
	textReplacement_data: Record<string, string>;
	/** 
	 * Enables or disables the UI Replacement Section
	 */
	isSelectionReplacementEnabled: boolean;

	/* --------------------------- Deprecation section -------------------------- */
	/**
	 * @deprecated: Use {@link isSelectionReplacementEnabled} instead
	 * @see isSelectionReplacementEnabled
	 */
	willReplaceSelection: boolean;
	//! shouldCreateOpen: CreateType, Deprecated: use [outputNoteHandling] instead.
	/**
	 * @deprecated: Use {@link outputNoteHandling} instead.
	 * @see outputNoteHandling
	 */
	shouldCreateOpen: CreateType;
	/**
	 * @deprecated: Use {@link selectionReplacementPolicy} instead.
	 * @see selectionReplacementPolicy
	 */
	shouldReplaceSelection: ReplacementStrategy;
	/* ----------------------- end of Deprecation section ----------------------- */


	constructor(globalSettings: iFT_PluginSettings, editorReference: Editor) {
		/* ----------------------------- Global Settings ---------------------------- */
		this.templateDirectoryPath = globalSettings.templateDirectoryPath;
		this.selectionReplacementPolicy = globalSettings.selectionReplacementPolicy;
		this.outputNoteHandling = globalSettings.outputNoteHandling;
		this.temptativeOutputFolder = globalSettings.temptativeOutputFolder;
		this.temptativeFileName = globalSettings.temptativeFileName;
		this.selectionReplacementTemplates = globalSettings.selectionReplacementTemplates;
		this.rawInputFieldList = globalSettings.rawInputFieldList;
		this.inputSplitPattern = globalSettings.inputSplitPattern;
		this.enableInputSuggestions = globalSettings.enableInputSuggestions;
		this.pluginConfigRaw = globalSettings.pluginConfigRaw;

		this.outputDirectory = "";
		this.outputFileName = "";

		/* ---------------------------- Extended Settings --------------------------- */
		// This settings section are used for execution only.

		//Empty defaults
		this.templateMetadata = {
			id: "",
			name: "",
			path: "",
		};

		//Current editor selection. Implementation of previous behaviour.
		this.editorReference = editorReference;
		this.editorSelection = this.editorReference.getSelection(); //string. Default: "" = no selection.

		switch (this.selectionReplacementPolicy) {
			case "always":
				this.isSelectionReplacementEnabled = true;
				break;

			case "selected-only":
				if (editorReference && this.editorSelection != "") {
					this.isSelectionReplacementEnabled = true;
					break;
				}
				this.isSelectionReplacementEnabled = false;
				break;
			case "never":
				this.isSelectionReplacementEnabled = false;
				break;
			default:
				this.isSelectionReplacementEnabled = false;
				break;
		}

		this.templateFileContent = ""; //TODO: Cual es su default? Proximo a deprecar
		this.templateProperties = {}; //TODO: Cual es su default? Proximo a deprecar
		this.fields = new Map();
		this.textReplacement_Pattern = ""; //TODO: deprecar: use [selectionReplacementTemplates[0]]
		this.textReplacement_data = {}; //TODO: deprecar:

		this.willReplaceSelection = false;
		this.shouldCreateOpen = "create";
		this.shouldReplaceSelection = "never";
	}
}

//! Unused
// /*
//  * Just produced in response to scanning for templates? Perhaps?
//  */
// export interface TemplateFolderSpec {
// 	location: TFolder;
// 	depth: number;
// 	numTemplates: number;
// }

/* -------------------------------------------------------------------------- */
/*                                   Events                                   */
/* -------------------------------------------------------------------------- */

/**
 * Typed ids for plugin-local DOM events used by the template workflow.
 *
 * Command -> FT_openInputModal -> TemplateInputModal -> FT_executeTemplate -> processor.ExecuteTempalteById()
 */
export enum FT_DomEventId {
	openInputModal = "FT_openInputModal",
	ExecuteTemplate = "FT_executeTemplate",
	TemplateModalClose = "FT_templateModalClose",
}

// Input Gathering Stage -> Execution Stage
/**
 * Event payload emitted when a template is submitted for execution.
 * Carries all context needed to invoke `TemplateProcessor.executeTemplateById()` and process the template.
 */
export type TemplateExecutionPayload = {
	readonly templateId: string;
	readonly inputData: Record<string, string>;
	readonly finalSettings: ExtendedSettings;
	//! readonly replacementOptions: ReplacementOptions; Included within [ExtendedSettings]
};

export class ExecuteTemplateEvent extends CustomEvent<TemplateExecutionPayload> {
	constructor(detail: TemplateExecutionPayload) {
		super(FT_DomEventId.ExecuteTemplate, { detail });
	}
}

//Command Stage -> Input Gathering Stage
export type InputModalPayload = {
	readonly targetTemplate: TemplateCacheEntry;
	readonly processor: FT_TemplateProcessor;
	/**
	 * Effective settings/context used to bootstrap the input modal for the
	 * selected template invocation.
	 * Includes pre-builded data for the UI to complete.
	 */
	readonly globalSettings: ExtendedSettings;
};
export class OpenInputModalEvent extends CustomEvent<InputModalPayload> {
	constructor(detail: InputModalPayload) {
		super(FT_DomEventId.openInputModal, { detail });
	}
}

export type InputModalCloseEventPayload = {
	readonly success: boolean;
	readonly error?: Error;
};
export class InputModalClosedEvent extends CustomEvent<InputModalCloseEventPayload> {
	constructor(detail: InputModalCloseEventPayload) {
		super(FT_DomEventId.TemplateModalClose, { detail });
	}
}

// Maps FT_DomEventId's to a specific payload. Improves Typescript autocomplete & helps during validation.
export type FT_DomEventDetailMap = {
	[FT_DomEventId.openInputModal]: InputModalPayload;
	[FT_DomEventId.ExecuteTemplate]: TemplateExecutionPayload;
	[FT_DomEventId.TemplateModalClose]: InputModalCloseEventPayload;
};
// Adds autocomplete + typechecking & reduces manual type casting.
declare global {
	interface HTMLElementEventMap {
		[FT_DomEventId.openInputModal]: OpenInputModalEvent;
		[FT_DomEventId.ExecuteTemplate]: ExecuteTemplateEvent;
		[FT_DomEventId.TemplateModalClose]: InputModalClosedEvent;
	}
}
