/**
 * Template input modal for collecting user data before template execution.
 */

import {
	Modal,
	Setting,
	ButtonComponent,
	TextComponent,
	TextAreaComponent,
	ToggleComponent,
	DropdownComponent,
    Value,
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
import { template } from "handlebars";

type inputControlType = "area" | "text" | "note-title" | "choice" | "multi" | "currentDate";

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

	/* ------------------------ Realtime Path Resolution ------------------------ */
	private _mustResolvePath:boolean = false;
	private _mustResolveName:boolean = false;

	private _destinationInfoElement?: HTMLElement;
	
	private _destinationInfoNameFields?: string[];
	private _nameTemplate?: string;
	private _destinationInfoRenderName?: (data:Record<string,unknown>) => string;

	private _destinationInfoPathFields?: string[];
	private _pathTemplate?: string;
	private _destinationInfoRenderPath?: (data:Record<string,unknown>) => string;

	constructor(plugin: FT_Plugin) {
		super(plugin.app);
		this._plugin = plugin;
		this._status = new TemplateStatusView(this.modalEl, this.contentEl);
		this._destinationInfoNameFields = [];

		// Command Trigger Stage -> Input Gathering Stage
		// Listen for "OpenInputModalEvent"
		this._plugin.eventBus.addEventListener(
			FT_DomEventId.openInputModal,
			(event: Event) => {
				console.log("Open Modal has ben called!");

				const openEvent = event as OpenInputModalEvent;
				const { targetTemplate, processor, globalSettings } = openEvent.detail;

				this._processor = processor;
				this._targetTemplate = targetTemplate;
				this._settings = globalSettings;

				console.debug("OTHER POSIBLE SETTINGS");
				console.debug(this._settings?.outputDirectoryPath);
				console.debug(this._settings?.outputFilenameTemplate);

				// Reset State, just in case.
				this._destinationInfoNameFields = [];
				this._destinationInfoRenderName = undefined;
				this._destinationInfoPathFields = [];
				this._destinationInfoRenderPath = undefined;

				// Dinamic Name
				this._mustResolveName = this._processor.isValidTemplate(this._settings.outputFilenameTemplate);
				if(this._mustResolveName){
					console.info("Filename must be resolved");
					this._nameTemplate = this._settings?.outputFilenameTemplate;
					const result = this._processor.prepareTemplate(this._nameTemplate);
					if(!result.ok) {
						console.error(result.error);
					}else{
						const {fieldNames, render} = result.value;
						this._destinationInfoNameFields = fieldNames;
						this._destinationInfoRenderName = render;
					}
				}
				
				// Dinamic Path
				this._mustResolvePath = this._processor.isValidTemplate(this._settings.outputDirectoryPath);
				if (this._mustResolvePath) {
					console.info("Directory must be resolved");
					this._pathTemplate = this._settings.outputDirectoryPath;
					const result = this._processor.prepareTemplate(this._pathTemplate);
					if (!result.ok) {
						console.error(result.error);
					} else {
						const { fieldNames, render } = result.value;
						this._destinationInfoPathFields = fieldNames;
						this._destinationInfoRenderPath = render;
					}
				}

				this.render(); //Pre-render UI
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

	render(): void {
		/* -------------------------- Input Gathering Stage ------------------------- */

		//TODO: Break settings here

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
		//TODO: Destination no es dinamico, todavia... (no muestra el path final calculado)
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
			text: `${this._settings?.outputDirectoryPath}/${this._settings?.outputFilenameTemplate}.md`,
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
		const templateConfig = this._settings;
		if (!templateConfig) return this;

		//At this stage templateConfig.fields is still undefined, so we have to construct it.
		// * Fields is our input for the next stage!
		const parsedFields = parseCsvStringList(templateConfig.rawInputFieldList);
		const fieldsData: TemplateField[] = templateConfig.fields; //This is uninitialized at this point.

		const setValue = (id: string, value: string) => {
			templateConfig.textReplacement_data[id] = value;
			this._status.setNeutral();
		};
		const submit = (index:number, id:string, value: string) =>{
			console.log(`${id}: submit triggered with value ${value}`);
			let next = index + 1;
			if(next > fieldElements.length - 1)
				next = 0;
			fieldElements[next].focus();

			if(!this._settings) return;

			//This might require multiple fields.
			if(this._mustResolveName && this._destinationInfoNameFields?.contains(id) && this._nameTemplate){
				let name = this._nameTemplate;
				if(this._destinationInfoRenderName){
					name = this._destinationInfoRenderName({[id]:value});
					console.log(`Resolved name is: ${name}`);
					// this._settings?.outputFilenameTemplate //!No se puede sobreescribir en este instante
				}
				this._settings.outputFilenameTemplate = name;
			}

			//Resolve path
			if( this._mustResolvePath && this._destinationInfoPathFields?.contains(id) && this._pathTemplate){
				let path = this._pathTemplate;
				if(this._destinationInfoRenderPath){
					path = this._destinationInfoRenderPath({[id]:value});
					console.log(`Resolved path is: ${path}`);
				}
				this._settings.outputDirectoryPath = path;
			}

			if(this._mustResolvePath || this._mustResolveName){
				const path = this._settings.outputDirectoryPath;
				const name = this._settings.outputFilenameTemplate;
				this._destinationInfoElement?.setText(`${path}/${name}.md`);
			}
		}

		console.debug("Fields", parsedFields);
		const fieldElements: HTMLElement[] = [];
		parsedFields.forEach((parsedField, index) => {
			let defaultType: inputControlType  = "text";
			//Special Fields:
			
			//Body is a special field
			if(parsedField === "body"){
				defaultType = "area"
			}

			if(parsedField === "templateResult") return;

			const field: TemplateField = {
				id: parsedField,
				inputType: defaultType,
				args: [],
				description: "",
				alternatives: []
			}
			
			// const id = field.id;
			// if (id === "currentTitle") return;
			// if (id === "currentPath") return;
			//? We have to fill some defaults here?
			// if(field.id === "title"){}

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

			//New Empty data field.
			const data: Record<string, string> = { [field.id]: field.id };
			const element = this.createInputControl(
				controlWrapper,
				field,
				data,
				setValue,
				submit,
				index
			)
			
			fieldElements.push(element);
			const keyEl = controlEl.createEl("div", {
				cls: "from-template-key-column",
			});	
			if (element) {
				if (index === 0) element.focus();
				element.addClass("from-template-control");
				if (index <= 8) {
					this.scope.register(["Mod"], `${index + 1}`, () => element.focus());
					keyEl.createEl("div", {
						text: `${index + 1}`,
						cls: "from-template-shortkey",
					});
				}
			}
		});

		return this;
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
				options.isSelectionReplacementEnabled = false;
		if (
			(options.selectionReplacementPolicy === "always") ||
			(options.selectionReplacementPolicy === "selected-only" && options.editorSelection.length > 0)
		) options.isSelectionReplacementEnabled = true;
		//Override
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
		controlEl: HTMLElement, //Required. Root Element.
		field: TemplateField,
		data: Record<string, string>,
		setTemplateValue: (k: string, v: any) => void,
		submit: (i:number, k:string, v:any) => void,
		// select: (i:number) => void,
		index: number,
		initial: string = ""
	): HTMLElement {
		// const name = field.id;
		
		console.debug(field);
		if (initial) data[field.id] = initial; //Auto-Fill

		try {
			// let textEl = new HTMLDivElement(); //Debe construirse sobre algo previo.
			let textEl = controlEl.createDiv();
			const inputType = field.inputType;
			const name = field.id;

			switch (inputType) {
				case "text": {
					const initial = data[name] || (field.args.length ? field.args[0] : "");
					
					const update = (value: string) => {
						console.debug(`${name} field has changed to ${value}`);
						setTemplateValue(name, value)
					};
					const textComponent = new TextComponent(controlEl)
						.setValue(initial)
						.onChange(update);
					textComponent.inputEl.size = 50;
					
					textEl = textComponent.inputEl;
					textEl.onkeydown = (ev:KeyboardEvent) =>{ //* WORKS
						// console.log(ev.code);
						if(ev.code === "Enter"){
							// console.log("ENTER");
							submit(index, name, textComponent.getValue());
						}
					}
					// textEl.onsubmit = () => {
					// 	console.log("MANDO WEAS");
					// }
					// textEl.onClickEvent((ev) => {
					// 	console.log("ONCLIC");
					// })

					//Runs when focus changes
					// textEl.onblur = () =>{
					// 	console.log("HE PERDIDO EL FOCO NIGGA");
					// }
					if (this._plugin.settings?.enableInputSuggestions) {
						if (name === "tags")
							new TagSuggest(textEl as HTMLInputElement, this.app, update);
						else new LinkSuggest(textEl as HTMLInputElement, this.app, update);
					}
					return textEl;
				}

				case "area": {
					const textAreaEl = new TextAreaComponent(controlEl)
						.setValue(data[name])
						.onChange((value) => setTemplateValue(name, value));
					textAreaEl.inputEl.rows = 5;
					const areaEl = textAreaEl.inputEl;
					areaEl.onkeydown = (ev:KeyboardEvent) =>{ //* WORKS
						console.log(ev.code);
						if(!ev.shiftKey && ev.code === "Enter"){
							// console.log("ENTER");
							submit(index, name, textAreaEl.getValue());
						}
						//Si presiono tab cancelo.
						//Si presiono control + 1 Selecciono un index especifico.
					}
					return textAreaEl.inputEl;
				}
	
				case "note-title": {
					const initial = data[name] || (field.args.length ? field.args[0] : "");
					const initial_safe = initial.replace(BAD_CHARS_FOR_FILENAMES_MATCH, "");
					data[name] = initial_safe;
					const error = controlEl.createEl("div", {
						text:
							"Error! Characters not allowed in filenames: " +
							BAD_CHARS_FOR_FILENAMES_TEXT,
						cls: "from-template-error-text",
					});
					const updateError = (v: string) => {
						if (v.match(BAD_CHARS_FOR_FILENAMES_MATCH))
							error.removeAttribute("hidden");
						else error.setAttribute("hidden", "true");
					};
					updateError(initial_safe);
					const textComponent = new TextComponent(controlEl)
						.setValue(initial_safe)
						.onChange((value) => {
							setTemplateValue(name, value);
							updateError(value);
						});
					textComponent.inputEl.size = 50;
					return textComponent.inputEl;
				}
	
				case "choice": {
					const opts: Record<string, string> = {};
					field.args.forEach((f) => (opts[f] = capitalize(f)));
					const dropDown = new DropdownComponent(controlEl)
						.addOptions(opts)
						.setValue(data[name])
						.onChange((value) => setTemplateValue(name, value));
					return dropDown.selectEl;
				}
	
				case "multi": {
					const selected: string[] = [];
					const spanEl = controlEl.createSpan();
					field.args.forEach((f) => {
						const d = spanEl.createDiv({ text: f });
						new ToggleComponent(d).setTooltip(f).onChange((value) => {
							if (value) selected.push(f);
							else selected.remove(f);
							setTemplateValue(name, selected.join(", "));
						});
					});
					return spanEl;
				}
	
				case "currentDate": {
					const fmt = field.args[0] || "yyyy-MM-dd";
					const cur = DateTime.now().toFormat(fmt);
					data[name] = cur;
					const textEl = new TextComponent(controlEl)
						.setValue(cur)
						.onChange((value) => setTemplateValue(name, value));
					textEl.inputEl.size = 50;
					return textEl.inputEl;
				}
			}
		} catch (error) {
			console.log("Throws error when creating textEl.")
			console.log(error)
		}

		return new HTMLDivElement();
	}
}
