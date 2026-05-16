import { PluginSettingTab, Setting } from "obsidian";
//Aviable: MarkdownView, Modal, normalizePath, Notice, Plugin, TextComponent, TFile, TFolder
import type {
	CreateType,
	iFT_PluginSettings,
	ReplacementStrategy,
} from "../Shared.js";
import FT_Plugin from "../main.js";
import { FT_TemplateProcessor } from "../TemplateProcessing.js";

export class FT_SettingTab extends PluginSettingTab {
	plugin: FT_Plugin;
	templateDirChanged: boolean = false;

	constructor(plugin: FT_Plugin) {
		super(plugin.app, plugin);
		this.plugin = plugin;
	}

	resetTracking() {
		this.templateDirChanged = false;
	}

	getDirectoryText(folder: string): [string, string, string] {
		const numFolders = this.plugin.processor?.countTemplates(folder);
		if (numFolders === undefined) {
			return [
				`⚠️ Directory to read templates from. '${folder}' does not exist`,
				"from-template-error-text",
				"from-template-ok-text",
			];
		} else {
			return [
				`✅ Directory to read templates from. '${folder}' has ${numFolders} templates`,
				"from-template-ok-text",
				"from-template-error-text",
			];
		}
	}

	hide(): void {
		console.debug("Settings panel closed");
		//Maybe it does have sense to re-index templates after edit-settings is done.
		if (this.templateDirChanged) {
			//We reload the templates directory.
			console.log("Should Trigger Reload");
		}
	}

	async display(): Promise<void> {
		const { containerEl } = this;
		console.debug(`Settings panel opened`);
		const pluginSettings: iFT_PluginSettings | undefined = this.plugin.settings;
		if (!pluginSettings) console.debug("No pluggin settings is aviable");
		const processor: FT_TemplateProcessor | undefined = this.plugin.processor;
		if (!processor) console.debug("No processor instance is loaded");

		containerEl.empty();
		containerEl.createEl("h2", { text: "Note From Template Settings" });

		const syncCurrentSettings = () => {
			this.plugin.settings = pluginSettings;
		};

		//This is not saving
		const dirSetting = new Setting(containerEl)
			.setName("Template Directory")
			.setDesc("Directory to read templates from");

		// Finding the right template folder
		const updateFolderDescription = (folder: string) => {
			try {
				const [text, clss, r_clss] = this.getDirectoryText(folder);
				dirSetting.descEl.addClass(clss);
				dirSetting.descEl.removeClass(r_clss);
			} catch (error) {
				console.error(error);
			}
		};

		if (processor && this.plugin && pluginSettings) {
			const folders = processor.getTemplateFolders();

			const opts: Record<string, string> = {};
			folders.forEach(
				(f) =>
					(opts[f.location.path] =
						"-".repeat(f.depth - 1) +
						` ${f.location.name} (${f.numTemplates})`),
			);

			//Template Directory
			dirSetting.addDropdown((text) =>
				text
					//.setPlaceholder('templates')
					.addOptions(opts)
					.setValue(pluginSettings.templateDirectoryPath)
					.onChange(async (value) => {
						this.templateDirChanged =
							pluginSettings.templateDirectoryPath !=
							this.plugin.settings?.templateDirectoryPath;

						pluginSettings.templateDirectoryPath = value;
						updateFolderDescription(value);

						syncCurrentSettings();
						await this.plugin.saveSettings();
					}),
			);

			updateFolderDescription(pluginSettings.templateDirectoryPath);

			new Setting(containerEl)
				.setName("Replace selection")
				.setDesc(
					"Should the current editor selection be replaced with a link to the title of the new Note?",
				)
				.addDropdown((toggle) =>
					toggle
						.addOption("always", "Always")
						.addOption("sometimes", "If Selected")
						.addOption("never", "Never")
						.setValue(pluginSettings.selectionReplacementPolicy)
						.onChange(async (value) => {
							pluginSettings.selectionReplacementPolicy =
								value as ReplacementStrategy;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Create and Open Note")
				.setDesc("Should a note be created and opened? If opened, in a pane?")
				.addDropdown((toggle) =>
					toggle
						.addOption("none", "Don't create note")
						.addOption("create", "Create but don't open")
						.addOption("open", "Create and open in this pane")
						.addOption("open-pane", "Create and open in new pane")
						.addOption("open-tab", "Create and open in new tab")
						.setValue(pluginSettings.outputNoteHandling)
						.onChange(async (value) => {
							pluginSettings.outputNoteHandling = value as CreateType;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(containerEl)
				.setName("Default output directory")
				.setDesc(
					'Where to put notes if they have not specified with {{template-output}}, Default value is "/" (Your Vault\'s root)',
				)
				.addText((text) =>
					text
						.setValue(pluginSettings.temptativeOutputFolder)
						.onChange(async (value: string) => {
							pluginSettings.temptativeOutputFolder = value;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(containerEl)
				.setName("Default template filename")
				.setDesc(
					"What to call notes if they have not specified {{template-filename}}",
				)
				.addText((text) =>
					text
						.setPlaceholder("{{title}}")
						.setValue(pluginSettings.temptativeFileName)
						.onChange(async (value) => {
							pluginSettings.temptativeFileName = value;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(containerEl)
				.setName("Default replacement string")
				.setDesc(
					"What replacement string to use if the template has not specified using {{template-replacement}}",
				)
				.addText((text) =>
					text
						.setValue(pluginSettings.selectionReplacementTemplates)
						.onChange(async (value) => {
							pluginSettings.selectionReplacementTemplates = value;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(containerEl)
				.setName("Default field list")
				.setDesc(
					"What fields to expect if they template does not specify with {{template-input}}",
				)
				.addText((text) =>
					text
						.setValue(pluginSettings.rawInputFieldList)
						.onChange(async (value) => {
							pluginSettings.rawInputFieldList = value;
							await this.plugin.saveSettings();
						}),
				);

			new Setting(containerEl)
				.setName("Selection split")
				.setDesc(
					'A regex to split up the input selection to fill in extra fields in the note creation box. Should default to "\\s+-\\s+"',
				)
				.addText((text) =>
					text
						.setValue(pluginSettings.inputSplitPattern)
						.onChange(async (value) => {
							pluginSettings.inputSplitPattern = value;
							await this.plugin.saveSettings();
						}),
				);
			new Setting(containerEl)
				.setName("Input Suggestions")
				.setDesc(
					'Add suggestion support to text boxes. Will add suggestions for links when typing [[, and for tags for a field called "tags"',
				)
				.addToggle((toggle) =>
					toggle
						.setValue(pluginSettings.enableInputSuggestions)
						.onChange(async (value) => {
							pluginSettings.enableInputSuggestions = value;
							await this.plugin.saveSettings();
						}),
				);
		}
	}
}
