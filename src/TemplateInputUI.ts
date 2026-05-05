import { type App, ButtonComponent, DropdownComponent, Editor, Modal, MomentFormatComponent, Notice, Plugin, PluginSettingTab, SearchComponent, Setting, TextAreaComponent, TextComponent, TFile, TFolder, Modifier, ToggleComponent, KeymapEventListener } from 'obsidian';
import type { FT_Plugin }  from './main';
import { type ActiveTemplate, type CreateType, type TemplateField, BAD_CHARS_FOR_FILENAMES_MATCH, BAD_CHARS_FOR_FILENAMES_TEXT, type ReplacementOptions } from './Shared';
import { DateTime } from "luxon";
import { LinkSuggest, TagSuggest } from './UISupport';
import { capitalize } from './utils';

type SubcontrolParams = {
    title:string;
    content?:string;
    description?:string;
    labelCls?:string[];
    contentCls?:string[];
    rowCls?:string[];
    keyDisplay?:string;
};

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
 * - On submit, calls `fillOutTemplate` on the active template and delegates writing to `FT_Plugin.writeTemplate`.
 */
export class TemplateInputModal extends Modal {
	plugin:FT_Plugin

	private _activeTemplate: ActiveTemplate | undefined;
	private _options: ReplacementOptions | undefined;
	
    constructor( plugin:FT_Plugin ) {
		super(plugin.app);
		this.plugin = plugin;
	}

    openWith(template: ActiveTemplate, options: ReplacementOptions): void {
        this._activeTemplate = template
        this._options = options
        super.open()
    }

    //Easier to read
    private makeSubcontrol(el:HTMLElement, params:SubcontrolParams): HTMLElement {
        const {title,content,description,labelCls=[],contentCls=[],rowCls=[],keyDisplay} = params
        const sc = el.createDiv({cls:["from-template-control-row",...rowCls]})
        const label = sc.createDiv({cls:"from-template-description-column"})
        label.createDiv({text: `${title}:`,cls:["from-template-sublabel",...labelCls]})
        if(description) label.createDiv({text: description,cls:["from-template-label-description",...labelCls]})
        const contr = sc.createDiv({cls:"from-template-control-column"})
        if( content )
            contr.createSpan({text: `${content}`,cls:["from-template-subcontrol",...contentCls]})
        if( keyDisplay ) {
            const key = sc.createDiv({cls:"from-template-key-column"})
            key.createDiv({text:keyDisplay, cls:"from-template-shortkey"})
        }

        return contr;
    }

	async onOpen() {
		const root = this.contentEl; //This is inconsistent.
        const title = this.titleEl;
        const body = this.contentEl;
        const activeTemplate = this._activeTemplate;
        const options = this._options;

        if(options && activeTemplate){
            //console.log("Data before filling out template",this.result.data)
            //Create the top of the interface - header and input for Title of the new note            
            this.modalEl.addClass("from-template-modal")
            this.titleEl.createEl('h4', { text: "Create from Template", cls:"from-template-title"});

            const errorField = root.createDiv({text:"", cls:"from-template-error-text"})
            const lowerError = root.createDiv({text:"", cls:"from-template-error-text"})
    
            const setError = (error:string) => {
                this.modalEl.addClass("from-template-Error")
                errorField.removeAttribute("hidden")
                errorField.setText(error)
                lowerError.removeAttribute("hidden")
                lowerError.setText(error)
                //alert(error)
            }
            const setNeutral = () => {
                this.modalEl.removeClass("from-template-Error")
                errorField.setAttribute("hidden","true")
                lowerError.setAttribute("hidden","true")
            }
            
            setNeutral();

            const setValue = (id:string,value:any) => { activeTemplate.data[id] = value; setNeutral() }
            const separator = () => root.createEl("hr",{cls:"from-template-section-sep"})
    
            // Elements for information
            this.makeSubcontrol(root,{
                    title:"Template",
                    content:`${activeTemplate.templateID.name}`,
                    rowCls:["from-template-control-row-minimal-space"]
                }
            )

            this.makeSubcontrol(root,
                {
                    title:"Destination",
                    content:`${activeTemplate.outputDirectory}/${activeTemplate.templateFilename}.md`,
                    contentCls:["from-template-code-span"], 
                    rowCls:["from-template-control-row-minimal-space"],
                    keyDisplay:"⌘+"
                }
            )

            separator()
    
            //Create each of the fields
            console.debug("Fields",activeTemplate.fields)
            activeTemplate.fields.forEach( (field,index) => {
                this.createInput(root,activeTemplate.data,field,setValue,index)
            })
            // An info box...
            // And the extra controls at the bottom
    
            /* Should text be replaced? It's a combination of:
             * - if it is turned on in the plugin. Will be yes/no/if selection
             * - if that is overriden in the template - same values
             * - is there text selected
             * For now, just using the settings value that is passed in
            */ 
            const willReplace = () => {
                if( options.shouldReplaceSelection === "always" ) return true;
                if( options.shouldReplaceSelection === "sometimes" && activeTemplate.input.length > 0 ) return true;
                return false;
            }
            options.willReplaceSelection = willReplace()
    
            const fieldNames = activeTemplate.fields.map(f => f.id)
            fieldNames.push("templateResult")
         
            let replacementText: TextComponent;
            const setReplaceText = (r:string) => {
                replacementText.setValue(r)
                activeTemplate.textReplacementString = r
            }

            separator()

            new Setting(root.createDiv({cls:"from-template-control-row-undivided"}))
                .setName("Replace selected text")
                //.setDesc(("String to replace selection with. Template fields: "+))
                //.setDesc(("String to replace selection with."))
                .addToggle(toggle => toggle
                    .setValue(willReplace())
                    .onChange(async (value) => {
                        options.willReplaceSelection = value;
                        replacementText.setDisabled(!value)
                    }))
    
            //const repDiv = contentEl.createEl("div", {text: "Replacement: ", cls:"setting-item-description"})
            const repDiv = this.makeSubcontrol(root,{title:"Replacement"})
            replacementText = new TextComponent(repDiv)
                .setValue(activeTemplate.textReplacementString)
                .onChange((value) => {
                    activeTemplate.textReplacementString =  value
                })
                .setDisabled(!willReplace());
                replacementText.inputEl.addClass("from-template-subcontrol")
            //replacementText.inputEl.size = 60

            const availFields = this.makeSubcontrol(root,{title:"Available fields",description:"for replacement string"})
            //const availFields = contentEl.createEl("div", {text: "Available fields: " , cls:"setting-item-description"})
            fieldNames.forEach(f => {
                const s = availFields.createEl("button",{text:f, cls:["from-template-inline-code-button"]})
                s.onClickEvent((e) => setReplaceText( replacementText.getValue() + `{{${f}}}` ) )
            })

            // Create buttons for the alternative replacements
            const alternatives = this.makeSubcontrol(root,{title:"Replacements",description:"specified in the template",keyDisplay:"^+"})
            //const alternatives = contentEl.createEl("div", { text: `Replacements:`, cls:["setting-item-description","from-template-command-list"]})
            activeTemplate.textReplacementTemplates.forEach( (r,i) => {
                const el = new ButtonComponent(alternatives)
                    .setButtonText(`${i+1}: ${r}`).onClick((e) => setReplaceText(r)).buttonEl
                el.addClass("from-template-inline-code-button")
                el.tabIndex = -1
                this.scope.register(['Ctrl'],`${i+1}`,()=>setReplaceText(r))
            })

            separator()

            new Setting(root.createDiv({cls:"from-template-control-row-undivided"}))
            .setName("Create and open note")
            .setDesc(("Should the note be created / opened?"))
            .addDropdown((dropdown) => {
                dropdown
                .addOption("none","Don't create")
                .addOption("create","Create, but don't open")
                .addOption("open","Create and open")
                .addOption("open-pane","Create and open in new pane")
                .addOption("open-tab","Create and open in new tab")
                .setValue(options.shouldCreateOpen)
                .onChange((value) => {
                    options.shouldCreateOpen = value as CreateType
                });
            });

            //On submit, get the data out of the form, pass through to main plugin for processing
            const submitTemplate = async()  => {
                console.debug("Filling out template")
                const result = await activeTemplate.template.fillOutTemplate(activeTemplate)
                try {
                    const writeResult = await this.plugin.writeTemplate(result,options)
                    if( !writeResult.ok ) {
                        setError(writeResult.message)
                        return
                    }
                    this.close()
                } catch( error ) {
                    console.debug("Unhandled error writing template",error)
                    setError( "Unexpected problem creating file: " + result.filename + "\n" + (error instanceof Error ? error.toString() : String(error)))
                }
            }

            //And a submit button
            const addDiv = root.createDiv({cls:"from-template-control-row"})
            addDiv.createDiv({cls:"from-template-description-column"})
            addDiv.createDiv({cls:"from-template-control-column"})
                .createEl('button', { text: "Add", cls:"from-template-submit" })
                    .addEventListener("click",submitTemplate);
            addDiv.createDiv({cls:"from-template-key-column"})
                .createDiv({ text: "↩", cls:"from-template-shortkey" })
            this.scope.register(['Mod'],"enter",() => { submitTemplate() } )
            root.appendChild(lowerError)
        }
        else{
            //When options or template are undefined for some reason.
            console.error(`Options is ${options} and template is ${activeTemplate}`);
        }
	}

	/*
	 * Creates the UI element for putting in the text. Takes a parent HTMLElement, and:
	 * - creates a div with a title for the control
	 * - creates a control, base on a field type. The 'field' parameter is taken from the template, and can be given as field:type
	*/
	createInput(parent:HTMLElement, data:Record<string,string>, field:TemplateField, setTemplateValue:(k:string,v:any)=>void, index:number=-1, initial:string=""){
        const id = field.id
        /*
         * Some fields don't need UI...
         */
        if(id === "currentTitle") return;
        if(id === "currentPath") return;
  
        // Create row, then a container for the label, the control and any hotkey
		const controlEl = parent.createEl('div',{cls:"from-template-control-row"});
		const labelContainer = controlEl.createEl("label", {cls:"from-template-description-column"})
		labelContainer.createEl("label", {text: `${capitalize(field.id)}`, cls:"from-template-label-text"})
        if( field.description && field.description.length > 0 )
		    labelContainer.createDiv({text: field.description, cls:"from-template-label-description"})
		labelContainer.htmlFor = id

        //console.debug(`Creating field with initial: '${initial}'`,field)

		const controlWrapper = controlEl.createEl('div',{cls:"from-template-control-column"});

        const element = this.createInputControl(controlWrapper, data, field, setTemplateValue, index, initial)
		const keyEl = controlEl.createEl('div',{cls:"from-template-key-column"});


        if( element ) {
            if( index === 0 ) element.focus()
            element.addClass("from-template-control")
            if( index <= 8 ) {
                this.scope.register(["Mod"],`${index+1}`,()=>element.focus())
                keyEl.createEl("div", {text: `${index+1}`, cls:"from-template-shortkey"}) 
            }
        }
	}

	createInputControl(
        controlEl:HTMLElement,
        data:Record<string,string>,
        field:TemplateField,
        setTemplateValue:(k:string,v:any)=>void,
        index:number=-1, //This is unused
        initial:string=""
    ) : HTMLElement
    { 

        const id = field.id
        const inputType = field.inputType
                 
        //Put the data into the record to start
        if( initial) data[field.id] = initial;

        let textEl:HTMLElement = new HTMLElement();

        switch (inputType) {
            
            case "area": {
                console.debug(field)
                const textAreaEl = new TextAreaComponent(controlEl)
                    .setValue(data[id])
                    .onChange((value) => setTemplateValue(id, value))
                textAreaEl.inputEl.rows = 5
                return textAreaEl.inputEl;
            }

            case "text": {
                console.debug(field)
                const initial = data[id] || (field.args.length ? field.args[0] : "")
                const cb = (value: string) => setTemplateValue(id, value)
                const textComponent = new TextComponent(controlEl)
                    .setValue(initial)
                    .onChange(cb)
                textComponent.inputEl.size = 50
                textEl = textComponent.inputEl
                if (this.plugin.settings?.inputSuggestions) {
                    if (id === "tags") new TagSuggest(textEl as HTMLInputElement, this.app, cb)
                    else new LinkSuggest(textEl as HTMLInputElement, this.app, cb)
                }
                return textEl;
            }
            
            case "note-title": {
                console.debug(field)
                const initial = data[id] || (field.args.length ? field.args[0] : "")
                const initial_safe = initial.replace(BAD_CHARS_FOR_FILENAMES_MATCH, "")
                data[id] = initial_safe
                const error = controlEl.createEl("div", { text: "Error! Characters not allowed in filenames: " + BAD_CHARS_FOR_FILENAMES_TEXT, cls: "from-template-error-text" })
                const updateError = (v: string) => {
                    if (v.match(BAD_CHARS_FOR_FILENAMES_MATCH)) error.removeAttribute("hidden")
                    else error.setAttribute("hidden", "true")
                }
                updateError(initial_safe)
                const textComponent = new TextComponent(controlEl)
                    .setValue(initial_safe)
                    .onChange((value) => { setTemplateValue(id, value); updateError(value) })
                textComponent.inputEl.size = 50
                return textComponent.inputEl;
            }
            
            case "choice": {
                const opts: Record<string, string> = {}
                field.args.forEach(f => opts[f] = capitalize(f))
                const dropDown = new DropdownComponent(controlEl)
                    .addOptions(opts)
                    .setValue(data[id])
                    .onChange((value) => setTemplateValue(id, value))
                return dropDown.selectEl;
            }
            
            case "multi": {
                const selected: string[] = []
                const spanEl = controlEl.createSpan()
                field.args.forEach((f) => {
                    const d = spanEl.createDiv({ text: f })
                    new ToggleComponent(d)
                        .setTooltip(f)
                        .onChange((value) => {
                            if (value) selected.push(f)
                            else selected.remove(f)
                            setTemplateValue(id, selected.join(", "))
                        })
                })
                return spanEl;
            }
            
            case "currentDate": {
                const fmt = field.args[0] || 'yyyy-MM-dd'
                const cur = DateTime.now().toFormat(fmt)
                data[id] = cur
                const textEl = new TextComponent(controlEl)
                    .setValue(cur)
                    .onChange((value) => setTemplateValue(id, value))
                textEl.inputEl.size = 50
                return textEl.inputEl;
            }
        }
        return textEl;
    }

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
};
