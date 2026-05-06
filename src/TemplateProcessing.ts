import { TAbstractFile, TFile, TFolder, Vault,  parseYaml, stringifyYaml} from 'obsidian';
import { TemplateMetadata, iFT_TemplateExecutionSettings,  TEMPLATE_FIELDS, Result, Ok, Err, iFT_PluginSettings } from './Shared.js'
import { compile } from 'handlebars';
import FT_Plugin from './main.js';

export class TemplateProcessor {
    plugin: FT_Plugin;
    vault: Vault;
    private _templateCache: TemplateCacheMap = {};

    constructor( plugin: FT_Plugin) {
        this.plugin = plugin;
        this.vault = plugin.app.vault;
    }

    cleanCache(): void {
        for (const entry of Object.values(this._templateCache)) {
            this.plugin.removeCommand(entry.meta.id)
        }
        this._templateCache = {}
    }

    getCachedTemplate(templateId: string): TemplateCacheEntry | undefined {
        return this._templateCache[templateId]
    }

    getCachedTemplateIds(): string[] {
        return Object.keys(this._templateCache)
    }

    /**
     * Resolves effective template action settings by merging two sources:
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
    private parseTemplateSettings(rawSettings: Record<string, any>, globalSettings: iFT_TemplateExecutionSettings): iFT_TemplateExecutionSettings {
        const resolved: iFT_TemplateExecutionSettings = {
            ...globalSettings,
        }

        if (typeof rawSettings['template-output'] === 'string')
            resolved.outputDirectoryPath = rawSettings['template-output']

        if (typeof rawSettings['template-input'] === 'string')
            resolved.inputFieldSpec = rawSettings['template-input']

        if (typeof rawSettings['template-filename'] === 'string')
            resolved.outputFilenameTemplate = rawSettings['template-filename']

        if (typeof rawSettings['template-should-replace'] === 'string')
            resolved.selectionReplacementPolicy = rawSettings['template-should-replace'] as iFT_TemplateExecutionSettings['selectionReplacementPolicy']

        if (typeof rawSettings['template-should-create'] === 'string')
            resolved.outputNoteHandling = rawSettings['template-should-create'] as iFT_TemplateExecutionSettings['outputNoteHandling']

        if (Array.isArray(rawSettings['template-replacement']))
            resolved.selectionReplacementTemplates = rawSettings['template-replacement']
        else if (typeof rawSettings['template-replacement'] === 'string')
            resolved.selectionReplacementTemplates = [rawSettings['template-replacement']]

        return resolved
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
    async loadFromDefaultLocation(settings: iFT_PluginSettings): Promise<Result<TemplateCacheMap, Error>> {

        if (!settings.templateDirectoryPath || !settings.templateDirectoryPath.trim())
            return Err(new Error("Template directory is empty or invalid"))

        this.cleanCache()
        const templateIdentifiers = await this.getTemplateIdentifiersFromDirectory(settings.templateDirectoryPath)
        const nextCache: TemplateCacheMap = {}

        for (const templateIdentifier of templateIdentifiers) {
            if (nextCache[templateIdentifier.id]) {
                console.warn(`Duplicate template id '${templateIdentifier.id}' found at '${templateIdentifier.path}'. Skipping.`)
                continue
            }

            const rawTemplateData = await this.noteToTemplateData(templateIdentifier.path)
            if (!rawTemplateData.ok) {
                console.warn(`Couldn't read template '${templateIdentifier.path}': ${rawTemplateData.error.message}`)
                continue
            }

            let compiledTemplate: HandlebarsCompiledTemplate
            try {
                const frontmatter = rawTemplateData.value.frontmatter
                const templateSource = Object.keys(frontmatter).length > 0
                    ? `---\n${stringifyYaml(frontmatter)}\n---\n${rawTemplateData.value.body}`
                    : rawTemplateData.value.body
                compiledTemplate = compile(templateSource)
            } catch (error) {
                console.warn(`Couldn't compile template '${templateIdentifier.path}': ${error instanceof Error ? error.message : String(error)}`)
                continue
            }

            nextCache[templateIdentifier.id] = {
                meta: templateIdentifier,
                compiledTemplate: compiledTemplate,
                rawData: rawTemplateData.value,
                templateSettings: this.parseTemplateSettings(rawTemplateData.value.template_settings, settings),
            }

            // For cleaning commands use cleanCache instead()
            this.plugin.addCommand({
                id: templateIdentifier.id,
                name: templateIdentifier.name,
                callback: async () => { this.plugin.launchTemplate(templateIdentifier) }
            })
        }

        this._templateCache = nextCache
        return Ok(this._templateCache)
    }

    /**
     * Executes a cached template by id using structured input data.
     *
     * This method uses the precompiled Handlebars template stored in cache,
     * renders it with `inputData`, and returns the rendered output alongside
     * useful metadata (template identity + resolved action settings).
     *
     * @param templateId Template id key from the cache.
     * @param inputData Structured data used as Handlebars context.
     * @returns `Ok({ output, meta })` when rendering succeeds, or `Err(Error)` otherwise.
     */
    async executeTemplateById(
        inputData: Record<string, unknown>,
        templateId: string,
    ): Promise<Result<TemplateExecutionResult, Error>> {
        const cached = this.getCachedTemplate(templateId)
        if (!cached) {
            return Err(new Error(`Template id '${templateId}' is not loaded in cache`))
        }

        //In a nutshell deberiamos invocar la ui, la ui requiere saber:
        // - Una representacion de los campos requeridos (Para mapear a inputs).
        // - Deberia retornar un inputData (esto se utiliza como informacion para rellenar el template real)

        inputData = this.preProcessTemplateInput(inputData, cached.templateSettings)

        let output: string
        try {
            output = cached.compiledTemplate(inputData)
        } catch (error) {
            return Err(new Error(`Couldn't execute template '${templateId}': ${error instanceof Error ? error.message : String(error)}`))
        }

        output = this.postProcessTemplateOutput(output, cached.templateSettings)

        return Ok({
            output,
            meta: {
                id: cached.meta.id,
                name: cached.meta.name,
                outputPath: `${cached.templateSettings.outputDirectoryPath}.md`,
            },
        })
    }

    /**
     * Pre-processes structured input data before template rendering.
     *
     * Current implementation is intentionally minimal:
     * it only destructures settings for future processing and returns input unchanged.
     */
    private preProcessTemplateInput(inputData: Record<string, unknown>, settings: iFT_TemplateExecutionSettings): Record<string, unknown> {
        const {
            selectionReplacementPolicy,
            outputNoteHandling,
            outputDirectoryPath,
            inputFieldSpec,
            selectionReplacementTemplates,
            outputFilenameTemplate,
        } = settings

        void selectionReplacementPolicy
        void outputNoteHandling
        void outputDirectoryPath
        void inputFieldSpec
        void selectionReplacementTemplates
        void outputFilenameTemplate

        return inputData
    }
    /**
     * Post-processes rendered template output.
     *
     * Current implementation is intentionally minimal:
     * TODO: use this to port Template.ts functionality here.
     * it only destructures settings for future processing and returns output unchanged.
     */
    private postProcessTemplateOutput(output: string, settings: iFT_TemplateExecutionSettings): string {
        const {
            selectionReplacementPolicy,
            outputNoteHandling,
            outputDirectoryPath,
            inputFieldSpec,
            selectionReplacementTemplates,
            outputFilenameTemplate,
        } = settings

        void selectionReplacementPolicy
        void outputNoteHandling
        void outputDirectoryPath
        void inputFieldSpec
        void selectionReplacementTemplates
        void outputFilenameTemplate

        return output
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

    /*
     * Returns all the templates in a directory
     * Run through the settings directory and return an TemplateSettings for each valid file there
     */
	async getTemplateIdentifiersFromDirectory(directory:string) : Promise<TemplateMetadata[]>  {
		const templateFolder:TFolder = this.vault.getAbstractFileByPath(directory) as TFolder
		if( ! templateFolder ) return Promise.all([])
        const children = templateFolder.children
        const files : TFile[] = children.filter( c => 
            {return c.path.endsWith(".md") && c instanceof TFile } ).map(c => c as TFile)
        const templates =  files.map( async c => this.getTemplateIdentifier(c) )
        return Promise.all( templates)
	}

    async getTemplateIdentifier(c:TFile) {
        try {
        const result = await this.noteToTemplateData(c.path)
        if (!result.ok) throw result.error
        const metadata = result.value.template_settings
        const fn = c.basename
        const tmpl:TemplateMetadata = {
            id:metadata['template-id'] || fn.toLowerCase(),
            name:metadata['template-name'] || fn,
            path:c.path,
        }
        return tmpl
        } catch( error ) {
            console.warn("Couldn't read template: " + c.path, error )
            return {
                id: c.name.toLowerCase(),
                name: "Can't parse " + c.name,
                path:c.path, 
            }
        }
    }

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

    /*
     * Reads in a markdown note file from the Vault, and returns:
     * - the body of the note
     * - a Record of the YAML frontmatter for the destination note
     * - a Record of the YAML that holds template settings and should not go into the destination note
     * Warning: This function assumes that path is valid (file exists in disk & it's not a directory)
     */
    async noteToTemplateData(path: string): Promise<Result<TemplateRawData, Error>> {
        const _debugging = "TemplateProcessor.noteToTemplateData()::\n    "
        const file = this.vault.getFileByPath(path)
        if (!file) return Err(new Error(`${_debugging}Template file not found at path: '${path}'`))
        const data = await this.vault.cachedRead(file)

        const matches = data.match(/---(.*?)---(.*)$/sm)
        if (!matches) return Ok({ body: data, frontmatter: {}, template_settings: {} })
        const [, frontMatter, body] = matches
        //TODO: Investigar Puede ser que matches solo de 1 si el frontmatter no esta precente?

        const file_props: Record<string, any> = {}
        const template_props: Record<string, any> = {}

        try {
            const parsedFT: Record<string, any> = parseYaml(frontMatter)
            for (const key in parsedFT) {
                if (TEMPLATE_FIELDS.contains(key)) template_props[key] = parsedFT[key]
                else file_props[key] = parsedFT[key]
            }
            return Ok({ body, frontmatter: file_props, template_settings: template_props })
        } catch (error) {
            return Err(new Error(`${_debugging}Couldn't parse frontmatter for '${path}': \n${error instanceof Error ? error.message : String(error)}`))
        }
    }

    /* 
    Parse the selected input in the editor, and turn it into values for some of the fields
    - input is the selected text, e.g. "Kevin - old friend - school"
    - spec is the list of field names, e.g. body,overview,tags
    - delimiter is what is between the different fields in the input (in this case " - ")
    */
    parseInput(input:string,spec:string,delimiter:string) : Record<string,string> {
        const fields = spec.split(",").map(s => s.trim())
        const input_parts = input.split(new RegExp(delimiter)).map(s=>s.trim())
        const zip = (a:string[], b:string[]) => Array.from(Array(Math.min(b.length, a.length)), (_, i) => [a[i], b[i]]);
        const r : Record<string,string> = {}
        zip(fields,input_parts).forEach(f => r[f[0]] = f[1])
        return r
    }

    /**
     * Counts the number of Markdown template files in a given folder.
     * @param folder - The vault path of the folder to inspect.
     * @returns The number of `.md` files found in the folder, or `0` if the folder does not exist.
     */
    countTemplates(folder:string) : number {
		const templateFolder:TFolder = this.vault.getAbstractFileByPath(folder) as TFolder
        if( !templateFolder ) return 0
        let templates  = templateFolder.children.filter(t => t.path.endsWith(".md"))
        return templates.length
    }

    //Dependency of Settings Pane (FT_SettingTab).
    getTemplateFolders() {
        const descend = (folder:TFolder, i:number, all:TemplateFolderSpec[] = []) => {
            if(i > 0) all.push({location:folder,depth:i+1, numTemplates:this.countTemplates(folder.path)})
            folder.children
                .filter(f => f instanceof TFolder)
                .forEach(f => descend(f as TFolder,i+1,all))
        }
        const result:TemplateFolderSpec[] = []
        descend(this.vault.getRoot(),0,result)
        console.debug(result)
        return result
    }
}

/*
 * Just produced in response to scanning for templates? Perhaps?
 */
type TemplateFolderSpec = {
    location:TFolder
    depth:number
    numTemplates:number
}

type TemplateRawData = {
    frontmatter: Record<string, any>
    template_settings: Record<string, any>
    body: string
}

type HandlebarsCompiledTemplate = ReturnType<typeof compile>

type TemplateCacheEntry = {
    meta: TemplateMetadata
    compiledTemplate: HandlebarsCompiledTemplate
    rawData: TemplateRawData
    /** Effective settings: global defaults merged with template-local raw overrides. */
    templateSettings: iFT_TemplateExecutionSettings
}

/**
 * Output contract for a cached template execution.
 *
 * - `output`: plain rendered string ready to be written to a file.
 * - `meta.id`: unique id of the executed template.
 * - `meta.name`: display name assigned to the executed template.
 * - `meta.outputPath`: resolved destination path where the output is intended to be written.
 */
type TemplateExecutionResult = {
    /** Plain rendered string ready to be written to disk. */
    output: string
    meta: {
        /** Unique id of the executed template. */
        id: string
        /** Human-readable name assigned to the executed template. */
        name: string
        /** Resolved destination path targeted for writing the rendered output. */
        outputPath: string
    }
}

type TemplateCacheMap = Record<string, TemplateCacheEntry>
