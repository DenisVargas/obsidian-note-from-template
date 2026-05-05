import { Plugin, App, MarkdownView, TFolder, type Editor, type PluginManifest, type TFile, type WorkspaceLeaf} from 'obsidian';
import { TemplateInputModal} from './TemplateInputUI';
import { FT_SettingTab } from './SettingsPane';
import { TemplateProcessor } from './TemplateProcessing';
import type { FT_PluginSettings, TemplateMetadata, ReplacementOptions, TemplateResult } from './Shared';
import { FolderCreateModal } from './UISupport';

export class FT_Plugin extends Plugin {
	
	/**
	 * Plugin settings loaded from Obsidian's data store.
	 * Undefined until {@link loadSettings} is called during plugin initialization.
	 */
	settings: FT_PluginSettings | undefined;
	/**
	 * Template processor responsible for managing and preparing templates.
	 * Initialized during plugin load with the vault instance.
	 * Undefined until {@link onload} is called.
	*/
	processor: TemplateProcessor | undefined;
	settingsTab: FT_SettingTab; //UI
	folderCreateModal: FolderCreateModal;
	templateInputModal: TemplateInputModal;
	addedCommands: string[];
	
	private _reIndexTemplatesCallback: () => void;

	constructor(app: App, manifest: PluginManifest) {
		super(app, manifest);
		console.log(`Root is ${this.app.vault.getRoot()}`)
		this.addedCommands = [];
		this.processor = new TemplateProcessor(this);
		this.settingsTab = new FT_SettingTab(this);

		/* ------------------------------- Obsidian UI ------------------------------ */
		
		this.folderCreateModal = new FolderCreateModal(this);
		this.templateInputModal = new TemplateInputModal(this);
		
		/* -------------------------- Re-Indexing Callback -------------------------- */
		this._reIndexTemplatesCallback = () => {
			this.indexTemplates()
			console.log("Reloaded Templates!")
		};
	}

	async onload() {
		this.settings = await this.loadSettings(); //Explict load settings from disk
		this.addSettingTab(this.settingsTab);
		
		this.processor?.loadFromDefaultLocation();

		this.addCommand({id:"reload",name:"Re-index Templates",callback: this._reIndexTemplatesCallback})
		this.app.workspace.onLayoutReady(this._reIndexTemplatesCallback);
	}

	async onunload() {
		this.removeCommand("reload");
		this.processor?.cleanCache();
		console.log('unloading plugin');
	}

	// Adds all the template commands - calls getTemplates which looks for files in the settings.templateDirectory
	async indexTemplates() {
		const processor = this.processor;

		if(processor){
			const loadResult = await processor.loadFromDefaultLocation()
			if (!loadResult.ok) {
				console.error(loadResult.error.message)
				return
			}
			console.log("Got templates: ", Object.values(loadResult.value).map(entry => entry.meta.path).join(", "))
		}
		console.info("Reloaded Templates!");
	}

	//This might be unnecesary, as of v1.4.4, aparently using when onunload() is called commands associated to this plugin are garbage collected.
	//https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines#Clean+up+resources+when+plugin+unloads
	clearTemplateCommands() {
		//From https://liamca.in/Obsidian/API+FAQ/commands/unload+a+Command
		//Use this.removeCommand() instead
		this.addedCommands.forEach(cid => {
			this.removeCommand(cid)
		})
	}

	/**
	 * Loads the selected template, gathers context from the active editor or view,
	 * and opens the input modal used to resolve template variables.
	 * @param templateId - The template identifier for the template being launched.
	 * @returns A promise that resolves once the template has been prepared and the modal opened.
	 */
	async launchTemplate( templateId: TemplateMetadata ) : Promise<void> {
		
		const view: MarkdownView | null = this.app.workspace.getActiveViewOfType(MarkdownView)
		
		if(view && this.processor && this.settings){
			const editor: Editor|undefined = view.editor;
			const initial_selection = this.getCurrentSelection( editor );

			//El flujo actual es invocar el inputModal para modificar el input que se le suministra al template.
			//Luego ejecuar el template.
			//Finalmente renderizar el resultado (escribir en disco donde corresponda).

			// prepareTemplate is deprecated.
			// Get the template text and the fields to fill in
			// const templateResult = await this.processor.prepareTemplate(
			// 	templateId,
			// 	this.settings,
			// 	initial_selection,
			// 	this.settings.inputSplit
			// )
			// if (!templateResult.ok) {
			// 	console.error(templateResult.error.message)
			// 	return
			// }
			// const template = templateResult.value
	
			// Can we fill in extra information here?
			// if( view && view.file) {
			// 	template.data['currentTitle'] = view.file.basename
			// 	template.data['currentPath'] = view.file.path
			// }
	
			// const options:ReplacementOptions = {
			// 	editor:editor,
			// 	shouldReplaceSelection:editor ? template.template.replaceSelection : "never",
			// 	shouldCreateOpen:template.template.createOpen,
			// 	willReplaceSelection:editor ? true : false,
			// }
			
			// this.templateInputModal.openWith(template, options);
		}
	}
	
	/**
	 * Writes a filled-out template to the vault, optionally replaces the active editor selection,
	 * and opens the newly created file according to the provided options.
	 *
	 * Returns a discriminated result object — never throws for expected IO failures.
	 * - `{ ok: true, fileCreated, filePath?, replacedSelection, openedFile }` on success.
	 * - `{ ok: false, code, message, cause? }` when file creation or file opening fails.
	 *   `code` is `"CREATE_FILE_FAILED"` or `"OPEN_FILE_FAILED"`.
	 *
	 * Unexpected errors (e.g. programming bugs) are still thrown and should be caught by the caller.
	 *
	 * @param result - The filled-out template data: note content, filename, folder and replacement text.
	 * @param options - Controls whether to create a file, replace the selection, and how to open the file.
	 * @returns A discriminated union — check `ok` before accessing success or error fields.
	 */
	async writeTemplate(result:TemplateResult, options:ReplacementOptions) : Promise<
		| { ok: true;  fileCreated: boolean; filePath?: string; replacedSelection: boolean; openedFile: boolean }
		| { ok: false; code: "CREATE_FILE_FAILED" | "OPEN_FILE_FAILED"; message: string; cause?: unknown }
	> {
		const vault = this.app.vault

		// First try to make the file
		console.debug("Making file")
		let newFile: TFile | null = null
		let openedFile = false
		if( options.shouldCreateOpen !== "none" ) {
			try {
				await this.createFolderIfNeeded(result.folder)
				const fullPath = result.folder + "/" + result.filename + ".md"
				newFile = await vault.create(fullPath, result.note)
			} catch (error) {
                console.debug("Error writing template",error)
				return {
					ok: false,
					code: "CREATE_FILE_FAILED",
					message: `Couldn't create file '${result.filename}': ${error instanceof Error ? error.message : String(error)}`,
					cause: error,
				}
			}
		}

		// Then see if we replace text in the editor
		if( options.willReplaceSelection ) 
			this.replaceCurrentSelection(result.replacementText,options.editor)

		// Then see if we should open the new file
		if( newFile) {
			console.debug("Opening")
			let leaf:WorkspaceLeaf | null = null
			if( options.shouldCreateOpen === "open" ) 
				leaf = this.app.workspace.getLeaf(false)
			else if( options.shouldCreateOpen === "open-pane" ) 
				leaf = this.app.workspace.getLeaf("split")
			else if( options.shouldCreateOpen === "open-tab" ) 
				leaf = this.app.workspace.getLeaf("tab")
			if( leaf ) {
				try {
					await leaf.openFile(newFile)
					openedFile = true
				} catch (error) {
					console.debug("Error opening created file",error)
					return {
						ok: false,
						code: "OPEN_FILE_FAILED",
						message: "Created file '" + result.filename + "' but couldn't open it.",
						cause: error,
					}
				}
			}
		}

		return {
			ok: true,
			fileCreated:newFile !== null,
			filePath:newFile?.path,
			replacedSelection:options.willReplaceSelection,
			openedFile:openedFile,
		}
	}

	/**
	 * Checks whether the provided vault path currently resolves to an existing folder.
	 *
	 * This method only validates existence and type (`TFolder`) at the exact path.
	 * It does not create folders, normalize paths, or validate intermediate segments.
	 *
	 * @param folder - Vault-relative folder path to validate.
	 * @returns `true` when the path exists and is a folder; otherwise `false`.
	 */
	checkIfFolderExists(folder:string): boolean {
		return this.app.vault.getAbstractFileByPath(folder) instanceof TFolder
	}

	async createFolderIfNeeded(folder: string) {
		if (this.checkIfFolderExists(folder)) return
		
		if (!await this.folderCreateModal.createDirectory(folder))
			throw new Error("Folder creation cancelled by user")
	}

	getCurrentSelection(editor?:Editor): string {
		if( editor ) return editor.getSelection();
		const selection = window.getSelection()
		if(!selection) return ""
		// console.log("Got no Editor, getting from window: ",selection)
		return selection.toString()
	}

	replaceCurrentSelection(repl:string, editor?:Editor) {
		if(editor) {
			console.log("Got Editor")
			editor.replaceRange(repl, editor.getCursor("from"), editor.getCursor("to"));
		}
		else {
			console.log("Got no Editor, putting text on clipboard: ", repl)
			navigator.clipboard.writeText(repl)
			// https://developer.mozilla.org/en-US/docs/Web/API/Selection
			//const sel = window.getSelection()
			//const selText = sel.toString()
			//if( sel.anchorNode === sel.focusNode ) {
		}
	}
	
	/**
	 * Loads plugin settings from Obsidian's persisted plugin data and merges them
	 * with the default configuration.
	 *
	 * This method is intentionally side-effect free with respect to plugin setup:
	 * it only reads stored data and returns a fully populated settings object.
	 * Because of that, it can also be reused by external classes or helper
	 * functions that need access to the resolved settings without depending on
	 * the plugin object {@link FT_Plugin.settings}.
	 *
	 * @returns The resolved plugin settings, combining persisted values with defaults.
	 */
	async loadSettings(): Promise<FT_PluginSettings> {
		const DEFAULT_SETTINGS: FT_PluginSettings = {
			outputDirectory:"",
			templateFilename:"{{title}}",
			inputFieldList:"title,body",
			textReplacementTemplates:["[[{{title}}]]"],
			templateDirectory: 'templates',
			replaceSelection: "always",
			createOpen: "open-tab",
			inputSplit: "\\s+-\\s+",
			inputSuggestions: true,
			config: '[]'
		}
		return await Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
