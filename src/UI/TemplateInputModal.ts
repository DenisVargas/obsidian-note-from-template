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
	KeymapEventHandler,
} from "obsidian";
import FT_Plugin from "../main.js";
import {
	FT_DomEventId,
	ExecuteTemplateEvent,
	OpenInputModalEvent,
	ExtendedSettings,
	type CreateType,
	type TemplateField,
    TemplateCacheEntry,
} from "../Shared.js";
import { FT_BuildInFields } from "../BuildIn.js";
//TODO import { DateTime } from "luxon";
import { LinkSuggest, overrideVaultFileName, TagSuggest, TemplateStatusView } from "./utils.js";
import { capitalize, parseCsvStringList } from "../utils.js";
import { FT_TemplateProcessor } from "../TemplateProcessing.js";
import { computedRef, Computed, ref, Reactive } from "./Signals.js";
import { OverrideError } from "../ErrorHandling.js";

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

	private _fields: Map<string,TemplateField>;
	private _fieldElements: HTMLElement[] = [];
	
	/* ----------------------------- Field Shortcuts ---------------------------- */

	private _fieldShortcutHandlers: KeymapEventHandler[] = [];

	/* ------------------------- Dynamic Path Resolution ------------------------ */

	private _destination: Computed<string>;
	private _nameRef: Reactive<string>;
	private _pathRef: Reactive<string>;
	private _destinationUnsubscribe?: () => void;
	
	private _mustResolveName:boolean = false;
	private _nameIsResolved:boolean = false;
	private _nameTemplate?: string;
	private _destinationInfoNameFields?: Record<string,string>;
	private _destinationInfo_RenderName?: (data:Record<string,unknown>) => string;
	
	private _mustResolvePath:boolean = false;
	private _pathIsResolved: boolean = false;
	private _pathTemplate?: string;
	private _destinationInfoPathFields?: Record<string,string>;
	private _destinationInfoRenderPath?: (data:Record<string,unknown>) => string;

	/* -------------------------------------------------------------------------- */

	constructor(plugin: FT_Plugin) {
		super(plugin.app);
		this._plugin = plugin;
		this._status = new TemplateStatusView(this.modalEl, this.contentEl);
		this._fields = new Map;
		this._nameRef = ref("");
		this._pathRef = ref("");
		this._destination = computedRef(
			[this._pathRef, this._nameRef],
			() => `${this._pathRef.value}/${this._nameRef.value}.md`,
		);

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
		this._destinationUnsubscribe?.();
		this._destination.destroy();
		this._busAbort.abort();
	}

	// onOpen() { } //Unused, keept for reference.
	onClose() {
		//Reset States
		const { contentEl, titleEl } = this;
		titleEl.empty(); //Garbage Collected
		contentEl.empty(); //Garbage Collected
		this._destinationUnsubscribe?.();
		this._destinationUnsubscribe = undefined;
		this._settings = undefined;
		this.clearFieldShortcuts();
		this._fieldElements = [];
		this._fields = new Map();
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
		this._destinationInfo_RenderName = undefined;
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
				this._destinationInfo_RenderName = render;
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

		// Sync reactive refs with current output values before rendering UI.
		this._nameRef.value = this._settings.outputFileName || this._settings.temptativeFileName;
		this._pathRef.value = this._settings.outputDirectory || this._settings.temptativeOutputFolder;

		//A nice Builder Pattern Here
		this.addHeader()
			.addBody()
				.addInfoSection()
				.addFieldsSection()
				.addReplacementSection()
				.addCreateOpenSection()
				.addSubmitSection();

		//Register Field Shortcuts & focus first field
		this.registerFieldShortcuts();
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

		// this._destination = new Reactive(`${this._settings?.temptativeOutputFolder}/${this._settings?.temptativeFileName}.md`);
		const destinationField = destinationValueContainer.createSpan({
			text: this._destination.value,
			cls: ["from-template-subcontrol", "from-template-code-span"],
		});
		this._destinationUnsubscribe?.();
		this._destinationUnsubscribe = this._destination.subscribe(value => {
			destinationField.setText(value);
		});

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
		//TODO: There is a blocking between enter & shortcuts.
		const settings = this._settings;
		if (!settings) return this;

		/*
		 !Not a good idea to extract from here.
		 * - EXTERNAL DEPENDENCIES (Side-effects):
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
		 * - this._nameRef/_pathRef: Modified (reactive destination dependencies)
		*/
		/**
		 * Updates the template data field and triggers dynamic name/path resolution.
		 */
		const updateFieldValue = (id: string, newValue: string, oldValue: string) => {
			settings.textReplacement_data[id] = newValue;
			this._status.setNeutral();

			if(!this._settings) return;

			/* -------------------------------------------------------------------------- */
			/*                        DINAMIC DESTINATION PATH/NAME                       */
			/* -------------------------------------------------------------------------- */
			
			// Dinamic Resolution of Output File Name.
			//!Warning: This might require multiple fields, if tempalte has more than just {{title}} or similar.
			if(this._mustResolveName && this._destinationInfoNameFields && this._nameTemplate && this._destinationInfo_RenderName){
				
				/** If current field is part of _destinationInfoNameFields */
				const isPartOfName = this._destinationInfoNameFields[id] != undefined;
				if(isPartOfName){

					let validName = newValue;
					const attempt = overrideVaultFileName(newValue);
					if(!attempt.ok && attempt.error.cause.current){
						//Drop a notification to the user, use normalized value instead.
						new Notice(attempt.error.message);
						validName = attempt.error.cause.current;
					}

					//First we fill the apropiate destinationField
					this._destinationInfoNameFields[id] = validName;
					console.log("Destination name fields is resolved as\n", this._destinationInfoNameFields);

					const name = this._destinationInfo_RenderName(this._destinationInfoNameFields);
					this._settings.outputFileName = name;
					this._nameRef.value = name;
					console.log(`Resolved name is: ${name}`);
					this._nameIsResolved = true;
				}
				// else console.log("is Not part of Name apparently"); // Debugging.
			}

			//Resolve path
			if( this._mustResolvePath && this._pathTemplate){
				let path = this._pathTemplate;
				if(this._destinationInfoRenderPath){
					path = this._destinationInfoRenderPath({[id]:newValue});
					console.log(`Resolved path is: ${path}`);
					this._pathIsResolved = true;
				}
				this._settings.outputDirectory = path;
				this._pathRef.value = path;
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

		// * Fields is our input for the next stage!
		console.debug("INCOMING FIELD MAP: \n", settings.fields);
		this._fields = new Map(settings.fields); //Copia de settings.fields

		let order = 0;
		this._fields.forEach((field, fieldID) => {
			if(field.inputType === "no-render") return;

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
				updateFieldValue,
				focusNextField,
				order
			)

			this._fields.set(field.id, field);

			this._fieldElements.push(element);
			const keyEl = controlEl.createEl("div", {
				cls: "from-template-key-column",
			});	

			if(order > 7) return; //We only count the first 8 valid Elements.
			if (element) {
				if (order === 0) element.focus();
				element.addClass("from-template-control");
				if (order <= 8) {
					keyEl.createEl("div", {
						text: `${order + 1}`,
						cls: "from-template-shortkey",
					});
				}
				order++;
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
				const token = `{{${fieldName}}}`;
				const currentValue = replacementText.getValue();
				if (currentValue.includes(token)) return;
				replacementText.setValue(currentValue + token);
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

				finalSettings.fields = this._fields;

				this._plugin.eventBus.dispatchEvent(
					new ExecuteTemplateEvent({
						templateId: finalSettings.templateMetadata.id,
						finalSettings,
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
		UpdateFieldValue: (key: string, newValue: any, oldValue:any) => void,
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
					const defaultValue = field.args ?  field.args[0] : "";
					const textComponent = new TextComponent(controlEl)
						.setValue(defaultValue)
						.onChange((newValue: string) => {
							console.log("currentValue:");
							console.log(textComponent.getValue());
							UpdateFieldValue(name, newValue, newValue)
						});
					textComponent.inputEl.size = 50;
						
					textEl = textComponent.inputEl;
					textEl.onkeydown = (ev:KeyboardEvent) => {
						if(ev.code === "Enter"){
							UpdateFieldValue(name,textComponent.getValue(), "");
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
					// 	console.log("Element Focused");
					// }
					//! don't use OnClic only.
					// textEl.onClickEvent((ev) => {
					// 	console.log("ONCLIC");
					// })

					if (this._plugin.settings?.enableInputSuggestions) {
						if (name === "tags")
							new TagSuggest(textEl as HTMLInputElement, this.app, ()=>{ UpdateFieldValue(name, defaultValue, "") });
						else new LinkSuggest(textEl as HTMLInputElement, this.app, ()=>{ UpdateFieldValue(name, defaultValue, "") });
					}
					return textEl;
				}

				case "area": {
					const value = field.args ?  field.args[0] : "";

					const textAreaEl = new TextAreaComponent(controlEl)
						.setValue(value)
						.onChange((value) => UpdateFieldValue(name, value, "")); //TODO: Fix oldValue
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

				//TODO: make sure that filename is valid.

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
						.onChange((value) => UpdateFieldValue(name, value, ""));
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
							UpdateFieldValue(name, selected.join(", "),"");
						});
					});
					return spanEl;
				}
	
				//TODO: This is a special case, use {{date}} instead
				//Special cases {{date}}{{date&time}} standart obsidian types
				// For inserting today use {{today}}
				// For inserting current hour use {{now}}
				// Combining you can combine them like this: "{{today}}{{now}}"
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

	private registerFieldShortcuts(): void {
		this.clearFieldShortcuts(); // limpia anteriores antes de registrar

		for (let index = 0; index < 9; index++) {
			const handler = this.scope.register(["Mod"], `${index + 1}`, () => {
				const element = this._fieldElements[index];
				if (!element || !element.isConnected) return;
				element.focus();
			});
			this._fieldShortcutHandlers.push(handler);
		}
	}
	private clearFieldShortcuts(): void {
		for (const handler of this._fieldShortcutHandlers) {
			this.scope.unregister(handler);
		}
		this._fieldShortcutHandlers = [];
	}
}
