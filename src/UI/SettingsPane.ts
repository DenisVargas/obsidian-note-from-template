import { PluginSettingTab, Setting } from 'obsidian';
//Aviable: MarkdownView, Modal, normalizePath, Notice, Plugin, TextComponent, TFile, TFolder
import type { CreateType,  iFT_PluginSettings,  ReplaceType } from '../Shared.js';
import FT_Plugin from "../main.js"

export class FT_SettingTab extends PluginSettingTab {
	plugin: FT_Plugin;

	constructor( plugin: FT_Plugin ) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	getDirectoryText(folder:string) : [string,string,string] {
		const numFolders = this.plugin.processor?.countTemplates(folder)
		if( numFolders === undefined ) {
			return [`⚠️ Directory to read templates from. '${folder}' does not exist`,'from-template-error-text','from-template-ok-text']
		}
		else {
			return [`✅ Directory to read templates from. '${folder}' has ${numFolders} templates`,'from-template-ok-text','from-template-error-text']
		}
	}

	hide(): void{
		console.log("Se cierra la wae");
	}

	async display(): Promise<void> {
		const {containerEl} = this;
		console.log(`SettingsPane::display()`)
		const pluginSettings: iFT_PluginSettings = await this.plugin.loadSettings();
		const processor = this.plugin.processor;

		containerEl.empty();
		containerEl.createEl('h2', {text: 'Note From Template Settings'});

		//This is not saving
		const dirSetting = new Setting(containerEl)
			.setName('Template Directory')
			.setDesc('Directory to read templates from');

		// Finding the right template folder
		const updateFolderDescription = (folder:string) => {
			try {
				const [text,clss,r_clss] = this.getDirectoryText(folder)
				dirSetting.descEl.addClass(clss)
				dirSetting.descEl.removeClass(r_clss)
			} catch (error) {
				console.error(error)
			}
		}

		if(processor && this.plugin){
			const folders = processor.getTemplateFolders()
	
			const opts : Record<string,string> = {}
			folders.forEach(f => opts[f.location.path] =
				("-".repeat(f.depth-1) + ` ${f.location.name} (${f.numTemplates})` )
			)
			dirSetting.addDropdown(text => text
				//.setPlaceholder('templates')
				.addOptions(opts)
				.setValue(pluginSettings.templateDirectoryPath)
				.onChange(async (value) => {
					pluginSettings.templateDirectoryPath = value;
					updateFolderDescription(value)
					this.plugin.settings = pluginSettings
					await this.plugin.saveSettings();
					//Is it a good idea to reindex the templates at this point?
					await this.plugin.indexTemplates(pluginSettings);
				}));
			
			updateFolderDescription(pluginSettings.templateDirectoryPath)
		}


		new Setting(containerEl)
			.setName('Replace selection')
			.setDesc('Should the current editor selection be replaced with a link to the title of the new Note?')
			.addDropdown(toggle => toggle
				.addOption("always","Always")
				.addOption("sometimes","If Selected")
				.addOption("never","Never")
				.setValue(pluginSettings.selectionReplacementPolicy)
				.onChange(async (value) => {
					pluginSettings.selectionReplacementPolicy = value as ReplaceType;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
		.setName('Create and Open Note')
		.setDesc('Should a note be created and opened? If opened, in a pane?')
		.addDropdown(toggle => toggle
			.addOption("none","Don't create note")
			.addOption("create","Create but don't open")
			.addOption("open","Create and open in this pane")
			.addOption("open-pane","Create and open in new pane")
			.addOption("open-tab","Create and open in new tab")
			.setValue(pluginSettings.outputNoteHandling)
			.onChange(async (value) => {
				pluginSettings.outputNoteHandling = value as CreateType;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
		.setName('Default output directory')
		.setDesc('Where to put notes if they have not specified with {{template-output}}, Default value is "/" (Your Vault\'s root)')
		.addText(text => text
			.setValue(pluginSettings.outputDirectoryPath)
			.onChange(async (value:string) => {
				pluginSettings.outputDirectoryPath = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
		.setName('Default template filename')
		.setDesc('What to call notes if they have not specified {{template-filename}}')
		.addText(text => text
			.setPlaceholder("{{title}}")
			.setValue(pluginSettings.outputFilenameTemplate)
			.onChange(async (value) => {
				pluginSettings.outputFilenameTemplate = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
		.setName('Default replacement string')
		.setDesc('What replacement string to use if the template has not specified using {{template-replacement}}')
		.addText(text => text
			.setValue(pluginSettings.selectionReplacementTemplates[0])
			.onChange(async (value) => {
				pluginSettings.selectionReplacementTemplates[0] = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
		.setName('Default field list')
		.setDesc('What fields to expect if they template does not specify with {{template-input}}')
		.addText(text => text
			.setValue(pluginSettings.inputFieldSpec)
			.onChange(async (value) => {
				pluginSettings.inputFieldSpec = value;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl)
			.setName('Selection split')
			.setDesc('A regex to split up the input selection to fill in extra fields in the note creation box. Should default to "\\s+-\\s+"')
			.addText(text => text
				.setValue(pluginSettings.inputSplitPattern)
				.onChange(async (value) => {
					pluginSettings.inputSplitPattern = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Input Suggestions')
			.setDesc('Add suggestion support to text boxes. Will add suggestions for links when typing [[, and for tags for a field called "tags"')
			.addToggle(toggle => toggle
				.setValue(pluginSettings.enableInputSuggestions)
				.onChange(async (value) => {
					pluginSettings.enableInputSuggestions = value;
					await this.plugin.saveSettings();
				}));
	}
}
