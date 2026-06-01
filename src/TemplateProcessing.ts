import { Editor, MarkdownView, TFile, TFolder, Vault, parseYaml, stringifyYaml } from "obsidian";
import {
	TemplateMetadata,
	TEMPLATE_FIELDS,
    FT_DomEventId,
	ExecuteTemplateEvent,
    OpenInputModalEvent,
	iFT_PluginSettings,
    ExtendedSettings,
    InputModalCloseEventPayload,
    InputModalPayload,
    TemplateCacheEntry,
    TemplateRawData,
    HandlebarsCompiledTemplate,
	TemplateField,
	iFT_PreExecutionSettings,
	
} from "./Shared.js";
import {
	Result,
	Ok,
	Err,
} from "./ErrorHandling.js";
import { compile, parse, template } from "handlebars";
import FT_Plugin from "./main.js";
import { FT_TemplateInputModal } from "./UI/TemplateInputModal.js";
import {
	buildVaultFilePath,
	containsFilenameToken,
	isUnsafeVaultFolderPath,
	normalizeVaultFolderPath,
	parseCsvStringList,
} from "./utils.js";
import { FT_BuildInFields } from "./BuildIn.js";

type TemplateCacheMap = Record<string, TemplateCacheEntry>;
export type PreparedTemplate = {
	fieldNames: Record<string, string>;
	render: (data:Record<string,unknown>) => string;
};

export class FT_TemplateProcessor {
	_plugin: FT_Plugin;
	_vault: Vault;
	private _templateCache: TemplateCacheMap = {};
	private _busAbort = new AbortController();

	constructor(plugin: FT_Plugin) {
		this._plugin = plugin;
		this._vault = plugin.app.vault;

		// Input Gathering Stage -> Command Execution Stage
		// Register to listen for TemplateExecutionEvents (called from UI: TemplateInputModal)
		this._plugin.eventBus.addEventListener(
			FT_DomEventId.ExecuteTemplate,
			(event: Event) => {
				console.debug("Execute Template has ben called!");
				const executeEvent = event as ExecuteTemplateEvent;
				const { templateId, inputData, finalSettings } = executeEvent.detail;

				this.executeTemplateById( templateId, inputData, finalSettings );
			},
			{ signal: this._busAbort.signal },
		)
	}

	destroy(): void {
		this._busAbort.abort();
	}

	cleanCache(): void {
		for (const entry of Object.values(this._templateCache)) {
			this._plugin.removeCommand(entry.meta.id);
		}
		this._templateCache = {};
	}

	getCachedTemplate(templateId: string): TemplateCacheEntry | undefined {
		return this._templateCache[templateId];
	}

	getCachedTemplateIds(): string[] {
		return Object.keys(this._templateCache);
	}

	/**
	 * **Command Trigger Stage**
	 * 
	 * Resolves effective template action settings by overriding globalSettings:
	 *
	 * 1) `globalSettings`: plugin-level defaults loaded from settings.
	 * 2) `rawSettings`: template-local overrides extracted from template metadata.
	 *
	 * The merge strategy starts from global defaults and only overwrites fields
	 * when a valid value is present in `rawSettings`.
	 *
	 * @param rawSettings Template-local settings parsed from `template_settings` metadata.
	 * @param globalSettings Plugin-wide default action settings.
	 * @returns A complete `iFT_TemplateExecutionSettings` object with defaults + overrides applied.
	 */
	private resolveTemplateSettings(
		rawSettings: Record<string, any>,
		globalSettings: iFT_PluginSettings,
	): iFT_PreExecutionSettings {
		const resolved: iFT_PreExecutionSettings = {
			...globalSettings,
			fields: new Map<string, TemplateField>(),
		};
		console.debug(`Global settings Input Field List ${resolved.rawInputFieldList}`); //* OK

		//We should be able to override global settings in a Template per Template basis.

		if (typeof rawSettings["template-output"] === "string") {
			if (containsFilenameToken(rawSettings["template-output"])) {
				console.warn(
					"template-output cannot contain {{filename}}. Falling back to vault root.",
				);
				resolved.temptativeOutputFolder = "";
			} else {
				resolved.temptativeOutputFolder = rawSettings["template-output"];
			}
		}

		const rawTemplateInput = rawSettings["template-input"];
		const templateInputFields =
			typeof rawTemplateInput === "string"
				? parseCsvStringList(rawTemplateInput)
				: Array.isArray(rawTemplateInput)
					? rawTemplateInput
						.map((value) => String(value).trim())
						.filter(Boolean)
					: [];

		if (templateInputFields.length > 0) {
			const finalInputFieldList = [
				...new Set([
					...parseCsvStringList(resolved.rawInputFieldList),
					...templateInputFields,
				]),
			];
			resolved.rawInputFieldList = finalInputFieldList.join(",");
			resolved.fields = this.parseTemplateInputFields(finalInputFieldList);
		} else {
			resolved.fields = this.parseTemplateInputFields(
				parseCsvStringList(resolved.rawInputFieldList),
			);
		}

		if (typeof rawSettings["template-filename"] === "string") {
			if (containsFilenameToken(rawSettings["template-filename"])) {
				console.warn(
					"template-filename cannot contain {{filename}}. Falling back to '{{title}}'.",
				);
				resolved.temptativeFileName = "{{title}}";
			} else {
				//This have to be resolved during execution phase.
				resolved.temptativeFileName = rawSettings["template-filename"];
			}
		}

		if (typeof rawSettings["template-should-replace"] === "string"){
			resolved.selectionReplacementPolicy = rawSettings["template-should-replace"] as iFT_PluginSettings["selectionReplacementPolicy"];

		}

		//What if template-should-create is not a string?
		if (typeof rawSettings["template-should-create"] === "string"){
			resolved.outputNoteHandling = rawSettings[
				"template-should-create"
			] as iFT_PluginSettings["outputNoteHandling"];
		}

		// Template-replacement maps to default Replacement string, currently "[[{{title}}]]"
		console.debug(rawSettings["template-replacement"])
		if (typeof rawSettings["template-replacement"] === "string"){
			resolved.selectionReplacementTemplates = rawSettings["template-replacement"];
		}

		return resolved;
	}

	/**
	 * Loads templates from the configured default directory, compiles them,
	 * stores them in cache, and registers one command per valid template.
	 *
	 * Returns `Ok(cache)` with successfully loaded entries.
	 * - Returns `Err(Error)` only for global failures (e.g. settings load failure,
	 *   invalid/empty template directory).
	 * - Per-template failures (read/parse/compile/duplicate id) are logged as warnings
	 *   and do not abort processing of remaining templates.
	 */
	async loadFromDefaultLocation(
		renderer: FT_TemplateInputModal, //! Unused for the time Being
		settings: iFT_PluginSettings,
	): Promise<Result<TemplateCacheMap, Error>> {
		/* -------------------------------------------------------------------------- */
		/*                            Command Trigger Stage                           */
		/* -------------------------------------------------------------------------- */
		if ( !settings.templateDirectoryPath || !settings.templateDirectoryPath.trim())
			return Err(new Error("Template directory is empty or invalid"));

		this.cleanCache();

		const templatePaths = await this.listTemplates( settings.templateDirectoryPath);
		const nextCache: TemplateCacheMap = {};

		for (const vaultFile of templatePaths) {
			//Given a TFile, load file, parse & convert its data into a representation of overrides & its internal content.
			const templateData = await this.noteToTemplateData(vaultFile);
			if (!templateData.ok) {
				console.warn(
					`Couldn't read template '${vaultFile.path}': ${templateData.error.message}`,
				);
				continue;
			}
			const rawData = templateData.value;
			const { frontmatter: rawFrontmatter, settings: rawSettings, body: rawbody } = rawData;
			// console.log("Meta data loaded" + meta) // * OK

			/* ---------------------------- Compile Template ---------------------------- */

			let templateSource:string = "";
			let compiledTemplate: HandlebarsCompiledTemplate;

			if(Object.keys(rawFrontmatter).length > 0)
				templateSource = `---\n${stringifyYaml(rawFrontmatter)}\n---\n${rawbody}`;
			else
				templateSource = rawbody;

			try {
				compiledTemplate = compile(templateSource);
			} catch (error) {
				console.warn(
					`Couldn't compile template '${vaultFile.path}': ${error instanceof Error ? error.message : String(error)}`,
				);
				continue;
			}

			/* ---------------------------- Resolved Settings --------------------------- */
			
			/** Contains global settings + template defined overrides */
			const resolvedSettings = this.resolveTemplateSettings(
				rawSettings,
				settings,
			)
			// This is base Settings, complete the extended version bellow.

			/* ----------------------------- Command Naming ----------------------------- */
			
			let vaultFileName = vaultFile.basename; //By Default we use the same name as the file.
			if(rawSettings["template-command-name"]){
				vaultFileName = rawSettings["template-command-name"];
				console.log("Command Registered as:"+ rawSettings["template-command-name"]);
			}

			/* -------------------------- Template Cache Entry -------------------------- */
			const meta: TemplateMetadata = {
				id: vaultFileName,
				name: vaultFileName,
				path: vaultFile.path
			}
			const cacheEntry: TemplateCacheEntry = {
				meta,
				rawData,
				compiledTemplate,
			};
			if (nextCache[meta.id]) {
				console.warn(
					`Duplicate template id '${meta.id}' found at '${vaultFile.path}'. Skipping.`,
				);
				continue;
			}
			nextCache[meta.id] = cacheEntry

			/* -------------------------- Command Registration -------------------------- */

			// We cannot directly open the Input Modal, we have to raise an event instead.
			// Template invocation Event
			// For cleaning commands use this.cleanCache()
			this._plugin.addCommand({
				id: meta.id,
				name: meta.name,
				callback: () => {
					// Command Trigger Stage -> Input Gathering Stage
					const view = this._plugin.app.workspace.getActiveViewOfType(MarkdownView);
					if (view && this && this._plugin.settings) {
						const editor: Editor = view.editor;

						const preExecutionSettings = new ExtendedSettings(resolvedSettings, editor);

						preExecutionSettings.templateMetadata = meta;

						const detail: InputModalPayload = {
							targetTemplate:cacheEntry,
							processor: this,
							globalSettings: preExecutionSettings
						};
						const openInputModal = new OpenInputModalEvent(detail);
						this._plugin.eventBus.dispatchEvent(openInputModal);
					}
				},
			});
		}

		this._templateCache = nextCache;
		return Ok(this._templateCache);
	}

	/**
	 * Executes a cached template by id using structured input data. 
	 * Called after UI has been invoked and an {@link ExecuteTemplateEvent} was catched correctly.
	 *
	 * This method uses the precompiled Handlebars template stored in {@link FT_TemplateProcessor._templateCache},
	 * renders it with {@link inputData}, and outputs the result based in {@link finalSettings} outputNoteHandling property.
	 *
	 * @see ExecuteTemplateEvent
	 * @see iFT_PluginSettings.outputNoteHandling
	 *
	 * @param templateId Template id key from the cache.
	 * @param inputData Structured data used as Handlebars context.
	 * @param finalSettings Runtime template settings/context coming from the UI flow.
	 */
	async executeTemplateById(
		templateId: string,
		inputData: Record<string, unknown>,
		finalSettings: ExtendedSettings
	): Promise<void> {
		/* -------------------------------------------------------------------------- */
		/*                           Command Execution Stage                          */
		/* -------------------------------------------------------------------------- */
		const cached = this.getCachedTemplate(templateId);
		if (!cached) {
			throw new Error(`Template id '${templateId}' is not loaded in cache`)
		}

		const render = cached.compiledTemplate;

		const outputNameRaw = String(finalSettings.outputFileName ?? "").trim();
		const outputNameNoPath = outputNameRaw.split("/").pop() ?? outputNameRaw;
		const runtimeFilename = outputNameNoPath.replace(/\.md$/i, "");
		inputData.filename = runtimeFilename;
		finalSettings.textReplacement_data.filename = runtimeFilename;

		//* AVIABLE
		// const { id, name: name, path } = cached.meta;
		// const { frontmatter, template_settings, body } = cached.rawData;

		/* ------------------------ Text (Editor) Replacement ----------------------- */

		if (finalSettings.selectionReplacementPolicy && finalSettings.editorReference) {
			const policy = finalSettings.selectionReplacementPolicy;
			const editor = finalSettings.editorReference;
			const selection = editor.getSelection();
			console.log(`Current SElection is ${selection}\nPolicy set as ${policy}`);
			if(policy === "always" || policy === "selected-only"){
				console.debug("Should replace selection");
				const replaceMentTemplate = compile(selection);
				const replaced = replaceMentTemplate(finalSettings.textReplacement_data);
				editor.replaceSelection(replaced);
			}
		}

		//TODO: Implement [MODE] for distintion between insertion and new File Creation.

		/* ------------------------ File Creation and Opening ----------------------- */
		try {
			const targetPathRaw = finalSettings.outputDirectory;
			const targetPath = isUnsafeVaultFolderPath(targetPathRaw)
				? ""
				: normalizeVaultFolderPath(targetPathRaw);
			if (targetPath === "" && targetPathRaw.trim() !== "" && isUnsafeVaultFolderPath(targetPathRaw)) {
				console.warn(
					`Unsafe output path '${targetPathRaw}' detected during execution. Falling back to vault root.`,
				);
			}
			finalSettings.outputDirectory = targetPath;

			const targetFileName = finalSettings.outputFileName;
			const OutputFileContent: string = render(inputData); //* OK

			//?: Should create a new file and place the rendered content as body.
			let resultFile: TFile; //The new File created as a vault file reference.
			switch(finalSettings.outputNoteHandling){
				case "none":
					console.log("Dont Create");
					//By default it doesnt do anything if you dont replace selection.
					//This functionality should be replaced by insertion mode.
					return;
				case "create":
					resultFile = await this.newVaultFile(OutputFileContent, targetPath, targetFileName);
					return;
				case "open":
					resultFile = await this.newVaultFile(OutputFileContent, targetPath, targetFileName);
					this._plugin.openFile(resultFile,'current');
					return
				case "open-tab":
					resultFile = await this.newVaultFile(OutputFileContent, targetPath, targetFileName);
					this._plugin.openFile(resultFile,'tab');
					return
				case "open-pane":
					resultFile = await this.newVaultFile(OutputFileContent, targetPath, targetFileName);
					this._plugin.openFile(resultFile,'split');
					return;
				default:
					break;
			}
		} catch (error) {
			console.debug( `Couldn't execute template '${templateId}': ${error instanceof Error ? error.message : String(error)}` );
		}
	}

	// /**
	//  * Loads a template from the vault and resolves its effective configuration.
	//  *
	//  * Builds a `FullTemplate` where template-level metadata (frontmatter keys such as `template-output`, `template-input`, etc.)
	//  * is merged with `defaults` whenever a setting is missing.
	//  *
	//  * This method only reads/parses template data and constructs the in-memory
	//  * template model. It does not create files or modify vault contents.
	//  *
	//  * @param templateSource Template identifier used to locate the source note in the vault.
	//  * @param defaults Default action settings used as fallback values for missing template metadata.
	//  * @returns `Ok(FullTemplate)` when loading/parsing succeeds, or `Err(Error)` when the
	//  *          template file does not exist or parsing fails.
	//  */
	// async loadTemplate(templateSource: TemplateMetadata, defaults:TemplateActionSettings ): Promise<Result<FullTemplate, Error>> {
	//     const templateFile = this.vault.getAbstractFileByPath(templateSource.path)
	//     if (!(templateFile instanceof TFile)) {
	//         return Err(new Error(`Template file not found at path: '${templateSource.path}'`))
	//     }

	//     const data = await this.noteToTemplateData(templateSource.path)
	//     if (!data.ok) return Err(data.error)

	//     return Ok(new FullTemplate(data.value.body, data.value.template_settings, data.value.frontmatter, defaults))
	// }

	// /**
	//  * Prepares a template so it can be used by the input/render flow.
	//  *
	//  * 1) Load and validate the template source.
	//  * 2) Parse the incoming text into field values using the provided delimiter.
	//  * 3) Build an `ActiveTemplate` object with template metadata, parsed data,
	//  *    and the default replacement text ready for the UI layer.
	//  *
	//  * This method does not write files or modify vault contents.
	//  *
	//  * @param TemplateSource Template identifier used to locate and load the template.
	//  * @param defaults Default template action settings applied when template metadata omits values.
	//  * @param input Raw input text to split into template field values.
	//  * @param delimiter Regular expression pattern used to split `input` into fields.
	//  * @returns `Ok(ActiveTemplate)` when preparation succeeds, or `Err(Error)` if loading/parsing fails.
	//  */
	// async prepareTemplate(
	//     TemplateSource:TemplateMetadata,
	//     defaults:TemplateActionSettings,
	//     input:string,
	//     delimiter:string="\\s+-\\s+"
	// ) : Promise<Result<ActiveTemplate, Error>> {

	//     console.debug("Getting template ready...",TemplateSource)
	// 	const templateResult = await this.loadTemplate( TemplateSource, defaults )

	//     console.debug("Got template result: ",templateResult)

	//     if (!templateResult.ok) return Err(templateResult.error)
	//     const template = templateResult.value

	//     console.debug("Splitting input: ",input, template.inputFieldList, delimiter)
	// 	const fieldData = this.parseInput(input,template.inputFieldList,delimiter)
	//     return Ok({
	// 		template:template,
	//         input:input,
	// 		templateID:TemplateSource,
	//         textReplacementString:template.textReplacementTemplates[0],
	// 		data:fieldData,
	//     })
	// }

	/**
	 * Enumerates markdown template files directly inside a vault directory.
	 *
	 * Current behavior is non-recursive: only immediate children of `directory`
	 * are inspected. Any child ending with `.md` and typed as `TFile` is treated
	 * as a valid template candidate.
	 *
	 * @param directory - Vault-relative folder path to inspect.
	 * @returns A promise with the list of matching template files. Returns an
	 * empty list when the directory does not exist.
	 */
	async listTemplates(
		directory: string,
	): Promise<TFile[]> {
		//TODO: Currently all .md files are valid as templates (no distintion)

		const templateFolder: TFolder = this._vault.getAbstractFileByPath(
			directory,
		) as TFolder;
		if (!templateFolder) return Promise.all([]);
		const children = templateFolder.children;
		const files: TFile[] = children
			.filter((c) => {
				return c.path.endsWith(".md") && c instanceof TFile;
			})
			.map((c) => c as TFile);
		
		// NO conversion required
		// const templates = files.map(async (c) => {
		// 	return c.path
		// });
		return Promise.all(files);
	}

	/** Currently Deprecated Behaviour:  */
	// async getTemplateIdentifier(vaultFile: TFile): Promise<Result<, Error>> {
	// 	try {
	// 		const result = await this.noteToTemplateData(vaultFile);
	// 		if (!result.ok) throw result.error;
	// 		const metadata = result.value.template_settings;
	// 		const fn = c.basename;
	// 		const tmpl: TemplateMetadata = {
	// 			id: metadata["template-id"] || fn.toLowerCase(),
	// 			name: metadata["template-name"] || fn,
	// 			path: c.path,
	// 		};
	// 		return tmpl;
	// 	} catch (error) {
	// 		console.warn("Couldn't read template: " + vaultFile.path, error);
	// 		return {
	// 			id: vaultFile.name.toLowerCase(),
	// 			name: "Can't parse " + vaultFile.name,
	// 			path: vaultFile.path,
	// 		};
	// 	}
	// }

	//Example of frontmatter:
	/*
	---
	template-output: Video Reviews
	template-filename:{{title}}
	template-input: title, url, channel, body

	tags: video-review,{{tags}}
	Mentions: {{channel}}
	Date: {{now:currentDate:dd-MM-yyyy}}
	---
	*/

	/**
	 * Reads in a markdown note file from the Vault, and returns:
	 * - the body of the note.
	 * - a Record of the YAML frontmatter for the destination note.
	 * - a Record of the YAML that holds template settings and should not go into the destination note.
	 * 
	 * Valid properties for the frontmatter are filtered by {@link TEMPLATE_FIELDS}
	 * 
	 * Warning: This function assumes that path is valid (file exists in disk & it's not a directory)
	 */
	async noteToTemplateData(
		vaultFile: TFile,
	): Promise<Result<TemplateRawData, Error>> {
		const _debugging = "TemplateProcessor.noteToTemplateData()::\n    ";
		const data = await this._vault.cachedRead(vaultFile);

		const matches = data.match(/---(.*?)---(.*)$/ms);
		if (!matches)
			return Ok({ body: data, frontmatter: {}, settings: {} });
		const [, frontMatter, body] = matches;
		
		//TODO: Investigar Puede ser que matches solo de 1 si el frontmatter no esta precente?

		const templateConfigs: Record<string, any> = {};
		const frontmatter: Record<string, any> = {};

		try {
			/** Full template-file front-matter */ 
			const fullFrontMatter: Record<string, any> = parseYaml(frontMatter);
			for (const key in fullFrontMatter) {
				//Filter template configs from content
				if (TEMPLATE_FIELDS.contains(key)) {
					templateConfigs[key] = fullFrontMatter[key];
					console.debug("TEMPLATE CONFIG:\n", key, "\n", templateConfigs[key]);
				}
				else frontmatter[key] = fullFrontMatter[key];
			}
			console.debug("Template Configs\n", templateConfigs);
			console.debug("Template FrontMatter:\n", frontmatter);

			return Ok({
				body,
				frontmatter,
				settings: templateConfigs,
			});
		} catch (error) {
			return Err(
				new Error(
					`${_debugging}Couldn't parse frontmatter for '${vaultFile}': \n${error instanceof Error ? error.message : String(error)}`,
				),
			);
		}
	}

	/**
	 * Creates a new markdown file in the provided vault folder.
	 *
	 * @param content - Full file body to write.
	 * @param outputPath - Destination folder in the vault.
	 * @param fileName - Desired file name.
	 * @returns The created vault file descriptor.
	 */
	async newVaultFile(content: string, outputPath: string, fileName: string): Promise<TFile>{
		const safeOutputPath = isUnsafeVaultFolderPath(outputPath)
			? ""
			: normalizeVaultFolderPath(outputPath);
		if (safeOutputPath === "" && outputPath.trim() !== "" && isUnsafeVaultFolderPath(outputPath)) {
			console.warn(
				`Unsafe output path '${outputPath}' detected before file creation. Falling back to vault root.`,
			);
		}

		const filePath = buildVaultFilePath(safeOutputPath, fileName);
		console.log("Target Path")
		console.log(filePath);
		await this._plugin.createFolderIfNeeded(safeOutputPath);
		const newFile = await this._vault.create(filePath, content);
		return newFile;
	}

	//TODO: Modify This.
	/**
	 * Parse the selected input in the editor, and turn it into values for some of the fields    
     * - input is the selected text, e.g. "Kevin - old friend - school"
     * - spec is the list of field names, e.g. body,overview,tags
     * - delimiter is what is between the different fields in the input (in this case " - ")
    */
	parseInput(
		input: string,
		spec: string,
		delimiter: string,
	): Record<string, string> {
		const fields = spec.split(",").map((s) => s.trim());
		const input_parts = input.split(new RegExp(delimiter)).map((s) => s.trim());
		const zip = (a: string[], b: string[]) =>
			Array.from(Array(Math.min(b.length, a.length)), (_, i) => [a[i], b[i]]);
		const r: Record<string, string> = {};
		zip(fields, input_parts).forEach((f) => (r[f[0]] = f[1]));
		return r;
	}

	private parseTemplateInputFields(templateInputList: string[]): Map<string, TemplateField> {
		return templateInputList.reduce<Map<string, TemplateField>>((acc, declaredField) => {
			//BuildIn contains default values for fields, renderable fields like ("title" & "body")
			// must be present in settings to be listed. Otherwise they are ignored.
			const builtIn = FT_BuildInFields.get(declaredField);
	
			if (builtIn) {
				// Defensive copy
				acc.set(declaredField, {
					...builtIn,
					id: declaredField,
					args: builtIn.args ? [...builtIn.args] : [],
					alternatives: builtIn.alternatives ? [...builtIn.alternatives] : [],
				});
				return acc;
			}

			//Special cases: templateResult, date&time, date
			//They are filled with default values, but final values
			// are resolved at execution stage.
	
			// Campo no built-in: default básico
			acc.set(declaredField, {
				id: declaredField,
				value: "",
				inputType: "text",
				description: "",
				args: [],
				alternatives: [],
				replaceOnly: false,
			});
	
			return acc;
		}, new Map<string, TemplateField>());
	}

	/**
	 * Counts the number of Markdown template files in a given folder.
	 * @param folder - The vault path of the folder to inspect.
	 * @returns The number of `.md` files found in the folder, or `0` if the folder does not exist.
	 */
	countTemplates(folder: string): number {
		const templateFolder: TFolder = this._vault.getAbstractFileByPath(
			folder,
		) as TFolder;
		if (!templateFolder) return 0;
		let templates = templateFolder.children.filter((t) =>
			t.path.endsWith(".md"),
		);
		return templates.length;
	}

	//Dependency of Settings Pane (FT_SettingTab).
	getTemplateFolders() {
		const descend = (
			folder: TFolder,
			i: number,
			all: TemplateFolderSpec[] = [],
		) => {
			if (i > 0)
				all.push({
					location: folder,
					depth: i + 1,
					numTemplates: this.countTemplates(folder.path),
				});
			folder.children
				.filter((f) => f instanceof TFolder)
				.forEach((f) => descend(f as TFolder, i + 1, all));
		};
		const result: TemplateFolderSpec[] = [];
		descend(this._vault.getRoot(), 0, result);
		console.debug(result);
		return result;
	}

	isValidTemplate(value: string): boolean {
	  if (!value || !value.trim()) return false;
	
	  // Detecta al menos un token Handlebars simple: {{campo}} o {{{campo}}}
	  const hasHandlebarsField = /{{{?\s*[A-Za-z_][\w.-]*\s*}?}}/;
	
	  return hasHandlebarsField.test(value);
	}

	prepareTemplate(templateSource:string): Result<PreparedTemplate,Error>{
		if(!templateSource || !templateSource.trim()){
			return Err(new Error("TEmplate Source is empty"));
		}

		try {
		  const compiled = compile(templateSource);
		  const ast = parse(templateSource);
		
		  const fieldNames = this.collectFieldNamesFromAst(ast);
		
		  return Ok({
			fieldNames,
			render: (data: Record<string, unknown>) => compiled(data),
		  });
		} catch (error) {
		  return Err(
			new Error(
			  error instanceof Error ? error.message : String(error),
			),
		  );
		}
	}

	private collectFieldNamesFromAst(node: any): Record<string, string> {
		const out: Record<string, string> = {};
		const visit = (n: any) => {
			if (!n || typeof n !== "object") return;

			if (n.type === "PathExpression" && typeof n.original === "string") {
				if (!n.original.startsWith("@") && n.original !== "this") {
					out[n.original] = "";
				}
			}
		
			for (const v of Object.values(n)) {
				if (Array.isArray(v)) v.forEach(visit);
				else if (v && typeof v === "object") visit(v);
			}
		};
		
		visit(node);
		return out;
	}
}

/*
 * Just produced in response to scanning for templates? Perhaps?
 */
type TemplateFolderSpec = {
	location: TFolder;
	depth: number;
	numTemplates: number;
};

//! Unused
// /**
//  * Output contract for a cached template execution.
//  *
//  * - `output`: plain rendered string ready to be written to a file.
//  * - `meta.id`: unique id of the executed template.
//  * - `meta.name`: display name assigned to the executed template.
//  * - `meta.outputPath`: resolved destination path where the output is intended to be written.
//  */
// type TemplateExecutionResult = {
// 	/** Plain rendered string ready to be written to disk. */
// 	output: string;
// 	meta: {
// 		/** Unique id of the executed template. */
// 		id: string;
// 		/** Human-readable name assigned to the executed template. */
// 		name: string;
// 		/** Resolved destination path targeted for writing the rendered output. */
// 		outputPath: string;
// 	};
// };
