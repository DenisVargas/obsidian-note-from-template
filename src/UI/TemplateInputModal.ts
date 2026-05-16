/**
 * Template input modal for collecting user data before template execution.
 */

import {
	Modal,
	Setting,
	TextComponent,
	TextAreaComponent,
	ToggleComponent,
	DropdownComponent,
    Notice,
} from "obsidian";
import FT_Plugin from "../main.js";
import {
	BAD_CHARS_FOR_FILENAMES_MATCH,
	BAD_CHARS_FOR_FILENAMES_TEXT,
	FT_DomEventId,
	ExecuteTemplateEvent,
	OpenInputModalEvent,
	ExtendedSettings,
	type CreateType,
	type TemplateField,
    TemplateCacheEntry,
} from "../Shared.js";
import { DateTime } from "luxon";
import { LinkSuggest, TagSuggest, TemplateStatusView } from "./utils.js";
import { capitalize, parseCsvStringList } from "../utils.js";
import { FT_TemplateProcessor } from "../TemplateProcessing.js";

type inputControlType = "area" | "text" | "note-title" | "choice" | "multi" | "currentDate";

// Pre-defined fields with default properties.
const defaultFields: Record<string, TemplateField> = {};
defaultFields["body"] = {
	id: "body",
	inputType: "area",
	args: [""],
	description: "The Note's content"
}
defaultFields["title"] = {
	id: "title",
	inputType: "text",
	args: ["Cool Title"],
	description: "Main Title"
}
//Special fields: Aviable for "Replace" but cannot be overwritten (doesnt generate UI Input Fields)
const specialFields: string[] = [
	"templateResult"
];

/**
 * Modal dialog that collects user input for filling out a template before writing the generated note.
 *
 * Opened via {@link OpenInputModalEvent} with an {@link ExtendedSettings} (containing the compiled template,
 * its metadata, and the pre-populated data record)(controlling whether/how the active editor selection is replaced).
 */
export class FT_TemplateInputModal extends Modal {
	_plugin: FT_Plugin;

	private _processor?: FT_TemplateProcessor;
	private _targetTemplate?: TemplateCacheEntry;
	private _settings?: ExtendedSettings;
	private _busAbort = new AbortController();
	private _status: TemplateStatusView;
	private _fields: Record<string, string>;

	/* ------------------------- Dynamic Path Resolution ------------------------ */
	private _destinationInfoElement?: HTMLElement;
	
	private _mustResolveName:boolean = false;
	private _nameIsResolved:boolean = false;
	private _nameTemplate?: string;
	private _destinationInfoNameFields?: Record<string,string>;
	private _destinationInfoRenderName?: (data:Record<string,unknown>) => string;
	
	private _mustResolvePath:boolean = false;
	private _pathIsResolved: boolean = false;
	private _pathTemplate?: string;
	private _destinationInfoPathFields?: Record<string,string>;
	private _destinationInfoRenderPath?: (data:Record<string,unknown>) => string;

	private _fieldElements: HTMLElement[] = [];
	private _fieldSettings: TemplateField[] = [];

	constructor(plugin: FT_Plugin) {
		super(plugin.app);
		this._plugin = plugin;
		this._status = new TemplateStatusView(this.modalEl, this.contentEl);
		this._fields = {};

		// Command Trigger Stage -> Input Gathering Stage
		this._plugin.eventBus.addEventListener(
			FT_DomEventId.openInputModal,
			(event: OpenInputModalEvent) => {
				const { targetTemplate, processor, globalSettings } = event.detail;

				this._processor = processor;
				this._targetTemplate = targetTemplate;
				this._settings = globalSettings;

				this.preRender();
				super.open();
			},
			{ signal: this._busAbort.signal },
		);
	}

	destroy(): void {
		this._busAbort.abort();
	}

	// onOpen() { } //Unused, keept for reference.
	onClose() {
		//Reset States
		const { contentEl, titleEl } = this;
		titleEl.empty(); //Garbage Collected
		contentEl.empty(); //Garbage Collected
		this._settings = undefined;
	}

	preRender(): void {
		/* -------------------------------------------------------------------------- */
		/*                            Input Gathering Stage                           */
		/* -------------------------------------------------------------------------- */

		if(!this._processor) return;
		if(!this._settings) return;

		/* -------------------------------------------------------------------------- */
		/*                             Dynamic Output Name                            */
		/* -------------------------------------------------------------------------- */
		
		// Reset State, just in case.
		this._destinationInfoNameFields = {};
		this._destinationInfoRenderName = undefined;
		this._destinationInfoPathFields = {};
		this._destinationInfoRenderPath = undefined;
		
		// Dinamic Name
		this._mustResolveName = this._processor.isValidTemplate(this._settings.temptativeFileName);
		if(this._mustResolveName){
			console.info("Filename must be resolved");
			this._nameTemplate = this._settings?.temptativeFileName;
			this._nameIsResolved = false;
			const res = this._processor.prepareTemplate(this._nameTemplate);
			if(!res.ok) {
				console.error(res.error);
			}else{
				const {fieldNames, render} = res.value;
				this._destinationInfoNameFields = fieldNames;
				this._destinationInfoRenderName = render;
			}
		} else {
			this._settings.outputFileName = this._settings.temptativeFileName;
		}
		
		// Dinamic Path
		this._mustResolvePath = this._processor.isValidTemplate(this._settings.temptativeOutputFolder);
		if (this._mustResolvePath) {
			console.info("Directory must be resolved");
			this._pathTemplate = this._settings.temptativeOutputFolder;
			this._pathIsResolved = false;
			const res = this._processor.prepareTemplate(this._pathTemplate);
			if (!res.ok) {
				console.error(res.error);
			} else {
				const { fieldNames, render } = res.value;
				this._destinationInfoPathFields = fieldNames;
				this._destinationInfoRenderPath = render;
			}
		} else{
			this._settings.outputDirectory = this._settings.temptativeOutputFolder;
		}

		//A nice Builder Pattern Here
		this.addHeader()
			.addBody()
				.addInfoSection()
				.addFieldsSection()
				.addReplacementSection()
				.addCreateOpenSection()
				.addSubmitSection();
	}

	addHeader(): this {
		this.modalEl.addClass("from-template-modal");
		this.titleEl.createEl("h4", {
			text: "Create from Template",
			cls: "from-template-title",
		});
		return this;
	}

	addBody(): this {
		//TODO: This needs rework, its using a TemplateStatusView that hides elements constructed.
		this._status.setNeutral();
		return this;
	}

	addInfoSection(): this {

		/* -------------------------- Source Template info -------------------------- */
		const templateRow = this.contentEl.createDiv({
			cls: ["from-template-control-row", "from-template-control-row-minimal-space"],
		});

		templateRow
			.createDiv({
				cls: "from-template-description-column",
			})
			.createDiv({
				text: "Template:",
				cls: ["from-template-sublabel"],
			});

		templateRow
			.createDiv({
				cls: "from-template-control-column",
			})
			.createSpan({
				text: `${this._targetTemplate?.meta.path}`,
				cls: ["from-template-subcontrol"],
			});

		/* ------------------------- Source Destination info ------------------------ */
		const destinationRow = this.contentEl.createDiv({
			cls: ["from-template-control-row", "from-template-control-row-minimal-space"],
		});
		destinationRow
			.createDiv({
				cls: "from-template-description-column",
			})
			.createDiv({
				text: "Destination:",
				cls: ["from-template-sublabel"],
			});

		const destinationValueContainer = destinationRow.createDiv({
			cls: "from-template-control-column",
		});

		const destinationField = destinationValueContainer.createSpan({
			text: `${this._settings?.temptativeOutputFolder}/${this._settings?.temptativeFileName}.md`,
			cls: ["from-template-subcontrol", "from-template-code-span"],
		});
		this._destinationInfoElement = destinationField;

		destinationRow
			.createDiv({
				cls: "from-template-key-column",
			})
			.createDiv({
				text: "⌘+",
				cls: "from-template-shortkey",
			});

		this.addSeparator();

		return this;
	}

	addFieldsSection(): this {
		//TODO: FIX THIS
		const settings = this._settings;
		if (!settings) return this;

		/**
		 * Updates the template data field and triggers dynamic name/path resolution.
		 * 
		 * EXTERNAL DEPENDENCIES (Side-effects):
		 * - settings: Modified directly (from addFieldsSection scope)
		 * - this._status: Calls setNeutral() (modifies UI state)
		 * - this._settings: Read/Modified (instance property)
		 * - this._mustResolveName: Read (instance flag)
		 * - this._destinationInfoNameFields: Read/Modified (instance record, mutated)
		 * - this._nameTemplate: Read (instance property)
		 * - this._destinationInfoRenderName: Executed (function from instance)
		 * - this._nameIsResolved: Modified (instance flag set to true)
		 * - this._mustResolvePath: Read (instance flag)
		 * - this._pathTemplate: Read (instance property)
		 * - this._destinationInfoRenderPath: Executed (function from instance)
		 * - this._pathIsResolved: Modified (instance flag set to true)
		 * - this._destinationInfoElement: Modified (setText called on element)
		 */
		const updateValue = (id: string, value: string) => {
			settings.textReplacement_data[id] = value;
			this._status.setNeutral();

			if(!this._settings) return;

			/* -------------------------------------------------------------------------- */
			/*                        DINAMIC DESTINATION PATH/NAME                       */
			/* -------------------------------------------------------------------------- */

			// Dinamic Resolution of Output File Name.
			//!Warning: This might require multiple fields, if tempalte has more than just {{title}} or similar.
			if(this._mustResolveName && this._destinationInfoNameFields && this._nameTemplate && this._destinationInfoRenderName){

				/** If current field is part of _destinationInfoNameFields */
				const isPartOfName = this._destinationInfoNameFields[id] != undefined;
				if(isPartOfName){
					//First we fill the apropiate destinationField
					this._destinationInfoNameFields[id] = value;
					console.log("Destination name fields is resolved as\n", this._destinationInfoNameFields);

					const name = this._destinationInfoRenderName(this._destinationInfoNameFields);
					this._settings.outputFileName = name;
					console.log(`Resolved name is: ${name}`);
					this._nameIsResolved = true;
				} 
				// else console.log("is Not part of Name apparently"); // Debugging.
			}
			// else { //! Could lead to problems.
			// 	this._settings.outputFileName = this._settings.temptativeFileName;
			// }

			//Resolve path
			if( this._mustResolvePath && this._pathTemplate){
				let path = this._pathTemplate;
				if(this._destinationInfoRenderPath){
					path = this._destinationInfoRenderPath({[id]:value});
					console.log(`Resolved path is: ${path}`);
					this._pathIsResolved = true;
				}
				this._settings.outputDirectory = path;
			}

			if(this._mustResolvePath || this._mustResolveName){
				const path = this._settings.outputDirectory;
				const name = this._settings.outputFileName;
				this._destinationInfoElement?.setText(`${path}/${name}.md`);
			}
		};
		const focusNextField = (index:number) =>{
			let next = index + 1;
			if(next > this._fieldElements.length - 1)
				next = 0;
			this._fieldElements[next].focus();
		}

		/* -------------------------------------------------------------------------- */
		/*                               FIELDS HANDLING                              */
		/* -------------------------------------------------------------------------- */

		//At this stage templateConfig.fields is still undefined, so we have to construct it.
		// * Fields is our input for the next stage!
		const parsedFields = parseCsvStringList(settings.rawInputFieldList);
		
		parsedFields.forEach((parsedField, index) => {
			const defaultType: inputControlType  = "text";
			if(specialFields.contains(parsedField)) return;

			const field: TemplateField = {
				id: parsedField,
				inputType: defaultType
			}

			// Allows us to fill defaults easily.
			const defaultField = defaultFields[parsedField];
			if (defaultField) {
				// Iterate over the keys of the defaultField object.
				for (const key of Object.keys(defaultField) as (keyof TemplateField)[]) {
					// Check if the value in defaultField is not undefined.
					const value = defaultField[key];
					if (value !== undefined) {
						// Handle both string and string[] cases explicitly.
						if (typeof value === "string" || Array.isArray(value)) {
							field[key] = value as TemplateField[typeof key];
						}
					}
				}
			}

			// const data: Record<string, string> = { [field.id]: field.id };

			// En los siguientes bloques:
			// - Construye la fila de UI de cada campo: etiqueta (nombre y descripción) + contenedor del control.
			// - Vincula metadatos del campo con la presentación (capitalize del id, htmlFor y clases CSS).
			// - Delega la creación del input al factory createInputControl según el tipo de campo.
			// - Registra cada elemento en fieldElements para soportar navegación por foco entre campos.
			// - Aplica foco automático al primer campo para optimizar el flujo de entrada al abrir el modal.
			// - Habilita atajos Mod+1..9 para salto directo y muestra la ayuda visual del atajo en la columna derecha.

			//TODO: Construir un Record<string,string> que contenga, los valores resueltos para cada campo.
			// Requisito para replacement.
			

			const controlEl = this.contentEl.createEl("div", {
				cls: "from-template-control-row",
			});
			const labelContainer = controlEl.createEl("label", {
				cls: "from-template-description-column",
			});
			labelContainer.createEl("label", {
				text: `${capitalize(field.id)}`,
				cls: "from-template-label-text",
			});
			if (field.description && field.description.length > 0)
				labelContainer.createDiv({
					text: field.description,
					cls: "from-template-label-description",
				});
			labelContainer.htmlFor = field.id;

			const controlWrapper: HTMLDivElement = controlEl.createEl("div", {
				cls: "from-template-control-column",
			});

			//Input Controls
			const element = this.createInputControl(
				controlWrapper,
				field,
				// data, //! Use field.
				updateValue,
				focusNextField,
				index //! Should use field.id instead xd.
			)

			this._fieldElements.push(element);
			const keyEl = controlEl.createEl("div", {
				cls: "from-template-key-column",
			});	
			if (element) {
				if (index === 0) element.focus();
				element.addClass("from-template-control");
				if (index <= 8) {
					this.scope.register(["Mod"], `${index + 1}`, () => this.selectField(index));
					keyEl.createEl("div", {
						text: `${index + 1}`,
						cls: "from-template-shortkey",
					});
				}
			}
		});

		return this;
	}

	selectField(index: number) {
		if (index >= 0 && index < this._fieldElements.length) {
			this._fieldElements[index].focus();
		}
	}

	private addReplacementSection(): this {
		const options = this._settings;
		if (!options) return this;

		this.addSeparator();

		//Añadimos un h2 "Source Text Replacement"
		this.contentEl.createEl("h5", {
			text: "Source Text Replacement",
			cls: "from-template-section-title",
		});
		
		/* ----------------------------- Replace toogle ----------------------------- */
		
		//Turn on-of replacement
		options.isSelectionReplacementEnabled = false;
		if (
			(options.selectionReplacementPolicy === "always") ||
			(options.selectionReplacementPolicy === "selected-only" && options.editorSelection.length > 0)
		) options.isSelectionReplacementEnabled = true;		
		new Setting( this.contentEl.createDiv({ cls: "from-template-control-row-undivided" }))
			.setName("Replace selected text")
			.addToggle((toggle) =>
				toggle
					.setValue(options.isSelectionReplacementEnabled)
					.onChange((value) => {
						options.isSelectionReplacementEnabled = value;
						replacementText.setDisabled(!value);
					}),
			);
		
		/* ------------------------------- FieldNames ------------------------------- */
			
		const fieldNames: string[] = parseCsvStringList(options.rawInputFieldList);
		fieldNames.push("templateResult");

		const availableFieldsRow = this.contentEl.createDiv({
			cls: ["from-template-control-row"]
		});
		const availableFieldsLabel = availableFieldsRow.createDiv({
			cls: "from-template-description-column"
		});
		availableFieldsLabel.createDiv({
			text: "Available fields:",
			cls: ["from-template-sublabel"]
		});
		availableFieldsLabel.createDiv({
			text: "for replacement string",
			cls: ["from-template-label-description"]
		});
		const availableFields = availableFieldsRow.createDiv({
			cls: "from-template-control-column"
		});

		fieldNames.forEach((fieldName) => {
			const button = availableFields.createEl("button", {
				text: fieldName,
				cls: ["from-template-inline-code-button"],
			});
			button.onClickEvent(() => {
				replacementText.setValue(
					replacementText.getValue() + `{{${fieldName}}}`,
				);
				options.textReplacement_Pattern = replacementText.getValue();
			});
		});
		
		/* ----------------------------- Replacement Row ---------------------------- */
		const replacementRow = this.contentEl.createDiv({
			cls: ["from-template-control-row"],
		});
		replacementRow
			.createDiv({
				cls: "from-template-description-column",
			})
			.createDiv({
				text: "Replacement:",
				cls: ["from-template-sublabel"],
			});
		

		// Crear primero el div de la columna
		const replacementColumn = replacementRow.createDiv({
			cls: "from-template-control-column",
		});
		
		//Rellenar options.textReplacement_Pattern
		if(options.selectionReplacementTemplates){
			options.textReplacement_Pattern = options.selectionReplacementTemplates;
		}
		console.log(options.textReplacement_Pattern); // * Uses template definition if aviable.

		// Luego crear el TextComponent usando ese div
		const replacementText = new TextComponent(replacementColumn)
			.setValue(options.textReplacement_Pattern)
			.onChange((value) => {
				options.textReplacement_Pattern = value;
			})
			.setDisabled(!options.isSelectionReplacementEnabled);
		// Asegurar la clase en el input
		replacementText.inputEl.addClass("from-template-subcontrol");

		/* ---------------------------- Replacements Enum --------------------------- */
		//! This enum was kinda unnecesary, since what we want is the "replacement" field for overrides.
		// const alternativesRow = this.contentEl.createDiv({
		// 	cls: ["from-template-control-row"]
		// });
		// const alternativesLabel = alternativesRow.createDiv({
		// 	cls: "from-template-description-column"
		// });
		// alternativesLabel.createDiv({
		// 	text: "Replacements:",
		// 	cls: ["from-template-sublabel"]
		// });
		// alternativesLabel.createDiv({
		// 	text: "specified in the template",
		// 	cls: ["from-template-label-description"]
		// });
		// const alternatives = alternativesRow.createDiv({
		// 	cls: "from-template-control-column"
		// });
		// const alternativesKey = alternativesRow.createDiv({
		// 	cls: "from-template-key-column"
		// });
		// alternativesKey.createDiv({
		// 	text: "^+",
		// 	cls: "from-template-shortkey"
		// });

		// const alts = [options.selectionReplacementTemplates];
		// alts.forEach(
		// 	(replacementValue, index) => {
		// 		const button = new ButtonComponent(alternatives)
		// 			.setButtonText(`${index + 1}: ${replacementValue}`)
		// 			.onClick(() => {
		// 				replacementText.setValue(replacementValue);
		// 				options.textReplacement_Pattern = replacementValue;
		// 			}).buttonEl;

		// 		button.addClass("from-template-inline-code-button");
		// 		button.tabIndex = -1;
		// 		this.scope.register(["Ctrl"], `${index + 1}`, () => {
		// 			replacementText.setValue(replacementValue);
		// 			options.textReplacement_Pattern = replacementValue;
		// 		});
		// 	},
		// );

		return this;
	}

	private addCreateOpenSection(): this {
		const finalSettings = this._settings;
		if (!finalSettings) return this;

		this.addSeparator();

		new Setting(
			this.contentEl.createDiv({ cls: "from-template-control-row-undivided" }),
		)
			.setName("Create and open note")
			.setDesc("Should the note be created / opened?")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("none", "Don't create")
					.addOption("create", "Create, but don't open")
					.addOption("open", "Create and open")
					.addOption("open-pane", "Create and open in new pane")
					.addOption("open-tab", "Create and open in new tab")
					.setValue(finalSettings!.outputNoteHandling)
					.onChange((value) => {
						finalSettings!.outputNoteHandling = value as CreateType;
					});
			});

		return this;
	}

	addSubmitSection(): this {
		const finalSettings = this._settings;
		console.log(this._settings);
		if (!finalSettings) return this;

		this.addSeparator();

		const row = this.contentEl.createDiv({ cls: "from-template-control-row" });
		row.createDiv({ cls: "from-template-description-column" });

		// Execute Template Event
		const submit = async () => {
			try {
				if(this._mustResolveName && !this._nameIsResolved) {
					new Notice("Destination Name is not resolved yet");
					return;
				}
				if(this._mustResolvePath && !this._pathIsResolved){
					new Notice("Destination Path is not resolved yet");
					return;
				}

				this._plugin.eventBus.dispatchEvent(
					new ExecuteTemplateEvent({
						templateId: finalSettings.templateMetadata.id,
						finalSettings: finalSettings,
						inputData: { ...finalSettings.textReplacement_data },
					}),
				);
				this.close();
			} catch (error) {
				console.debug("Unhandled error dispatching template event", error);
				this._status.setError(
					error instanceof Error ? error.message : String(error),
				);
			}
		};

		row
			.createDiv({ cls: "from-template-control-column" })
			.createEl("button", { text: "Add", cls: "from-template-submit" })
			.addEventListener("click", () => {
				void submit();
			});

		row
			.createDiv({ cls: "from-template-key-column" })
			.createDiv({ text: "↩", cls: "from-template-shortkey" });

		this.scope.register(["Mod"], "enter", () => {
			void submit();
		});

		return this;
	}

	private addSeparator(): void {
		this.contentEl.createEl("hr", { cls: "from-template-section-sep" });
	}

	createInputControl(
		controlEl: HTMLElement, // Root Element.
		field: TemplateField,
		UpdateFieldValue: (k: string, v: any) => void,
		ProceedToNextField: (i:number) => void,
		index: number
	): HTMLElement {
		try {
			// let textEl = new HTMLDivElement(); //Debe construirse sobre algo previo.
			let textEl = controlEl.createDiv();
			const inputType = field.inputType;
			const name = field.id;

			switch (inputType) {
				case "text": {
					// console.log(`Modifing ${name} with default ${initial}`);
					const value = field.args ?  field.args[0] : "";
					
					const update = (value: string) => {
						console.debug(`${name} field has changed to ${value}`);
						UpdateFieldValue(name, value)
					};

					const textComponent = new TextComponent(controlEl)
						.setValue(value)
						.onChange(update);
					textComponent.inputEl.size = 50;
					
					textEl = textComponent.inputEl;
					textEl.onkeydown = (ev:KeyboardEvent) => {
						if(ev.code === "Enter"){
							UpdateFieldValue(name,textComponent.getValue());
							ProceedToNextField(index);
						}
					}
					//! Unwanted side effects: interferes with tab & ctrl+num
					// textEl.onblur = () =>{
					// 	//Adds supports for tab & ctrl+number
					// 	submit(index, name, textComponent.getValue());
					// }
					//Run when element is given the focus.
					// textEl.onfocus = (ev) => {
					// 	console.log("HE GANADO EL FOCO NIGGA");
					// }
					//! don't use OnClic only.
					// textEl.onClickEvent((ev) => {
					// 	console.log("ONCLIC");
					// })

					if (this._plugin.settings?.enableInputSuggestions) {
						if (name === "tags")
							new TagSuggest(textEl as HTMLInputElement, this.app, update);
						else new LinkSuggest(textEl as HTMLInputElement, this.app, update);
					}
					return textEl;
				}

				case "area": {
					const value = field.args ?  field.args[0] : "";

					const textAreaEl = new TextAreaComponent(controlEl)
						.setValue(value)
						.onChange((value) => UpdateFieldValue(name, value));
					textAreaEl.inputEl.rows = 5;
					const areaEl = textAreaEl.inputEl;
					areaEl.onkeydown = (ev:KeyboardEvent) =>{
						if(!ev.shiftKey && ev.code === "Enter"){
							ProceedToNextField(index);
						}
					}
					//! Bad idea, interferes with ctrl+num & focus()
					// areaEl.onblur = () =>{
					// 	updateValue(index, name, textAreaEl.getValue());
					// }
					return textAreaEl.inputEl;
				}

				//! Deprecated in favor of arbitrary fields. Look for "Dynamic Output Name".
				// case "note-title": {
				// 	const value = field.args ? field.args[0] : "";
				// 	const initial_safe = value.replace(BAD_CHARS_FOR_FILENAMES_MATCH, "");
				// 	data[name] = initial_safe;

				// 	const error = controlEl.createEl("div", {
				// 		text:
				// 			"Error! Characters not allowed in filenames: " +
				// 			BAD_CHARS_FOR_FILENAMES_TEXT,
				// 		cls: "from-template-error-text",
				// 	});
				// 	const updateError = (v: string) => {
				// 		if (v.match(BAD_CHARS_FOR_FILENAMES_MATCH))
				// 			error.removeAttribute("hidden");
				// 		else error.setAttribute("hidden", "true");
				// 	};
				// 	updateError(initial_safe);
				// 	const textComponent = new TextComponent(controlEl)
				// 		.setValue(initial_safe)
				// 		.onChange((value) => {
				// 			UpdateFieldValue(name, value);
				// 			updateError(value);
				// 		});
				// 	textComponent.inputEl.size = 50;
				// 	return textComponent.inputEl;
				// }
	
				case "choice": {
					if(!field.args) return controlEl;
					const value = field.args ?  field.args[0] : "";

					const opts: Record<string, string> = {};
					field.args.forEach((f) => (opts[f] = capitalize(f)));
					const dropDown = new DropdownComponent(controlEl)
						.addOptions(opts)
						.setValue(value)
						.onChange((value) => UpdateFieldValue(name, value));
					return dropDown.selectEl;
				}

				case "multi": {
					if(!field.args) return controlEl;
					// const value = field.args ?  field.args[0] : "";

					const selected: string[] = [];
					const spanEl = controlEl.createSpan();
					field.args.forEach((f) => {
						const d = spanEl.createDiv({ text: f });
						new ToggleComponent(d).setTooltip(f).onChange((value) => {
							if (value) selected.push(f);
							else selected.remove(f);
							UpdateFieldValue(name, selected.join(", "));
						});
					});
					return spanEl;
				}
	
				//* This is a special case, use {{date}} instead
				// For inserting today use {{today}}
				// For inserting current hour use {{now}}
				// Combining you can combine them like this: "{{today}}:{{now}}"
				// Or use {{date:format}}

				// case "currentDate": {
				// 	const fmt = field.args[0] || "yyyy-MM-dd";
				// 	const cur = DateTime.now().toFormat(fmt);
				// 	data[name] = cur;
				// 	const textEl = new TextComponent(controlEl)
				// 		.setValue(cur)
				// 		.onChange((value) => UpdateFieldValue(name, value));
				// 	textEl.inputEl.size = 50;
				// 	return textEl.inputEl;
				// }
			}
		} catch (error) {
			console.error(error)
		}

		return new HTMLDivElement();
	}
}

