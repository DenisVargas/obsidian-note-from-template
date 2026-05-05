import { AbstractInputSuggest, type App, FuzzySuggestModal, Modal, type SearchResult, TFile, TextComponent, prepareFuzzySearch } from "obsidian";
import { FT_Plugin } from "./main";

export class FolderCreateModal extends Modal {
    private folderPath:string | null = null
    private resolveFn:((created:boolean)=>void) | null = null
    private rejectFn:((reason?:unknown)=>void) | null = null

    constructor( plugin: FT_Plugin ) {
        super(plugin.app)
    }

    createDirectory(folderPath:string): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.folderPath = folderPath
            this.resolveFn = resolve
            this.rejectFn = reject
            this.open()
        })
    }

    private settle(result:boolean, error?:unknown) {
        const resolve = this.resolveFn
        const reject = this.rejectFn
        this.resolveFn = null
        this.rejectFn = null
        this.folderPath = null
        if (error) {
            reject?.(error)
            return
        }
        resolve?.(result)
    }
	
    async onOpen() {
		if (!this.folderPath) return
		const {contentEl} = this;
        contentEl.empty()
        //this.modalEl.addClass("from-template-modal")
    		//And a submit button
        const folder_to_create = 
            contentEl.createEl('h4', { text: "Missing parent folder for note"});
            contentEl.createEl('div',{text: this.folderPath,cls:"from-template-error-text"})
            contentEl.createEl('hr')
        contentEl.createEl('div',{text: "This folder does not exist. Do you want to create it now?"})
        contentEl.createEl('hr')
		const submits = contentEl.createDiv()
        const createFolder = async () => {
            try {
                await this.app.vault.createFolder(this.folderPath!)
                this.settle(true)
            } catch (error) {
                this.settle(false, error)
            }
            this.close()
        }
        const notCreateFolder = () => {
            this.settle(false)
            this.close()
        }
        submits.createEl('button', { text: "Create"})
            .addEventListener("click",createFolder);
        submits.createEl('button', { text: "Don't Create"})
            .addEventListener("click",notCreateFolder);
    }

    onClose() {
        this.contentEl.empty()
        if (this.resolveFn || this.rejectFn) this.settle(false)
    }
}

/*
 * Class that can be added to an existing inputElement to add suggestions.
 * It needs an implementation of `getContent` to provide the set of things to suggest from
 * By default it does a FuzzySearch over these: this can be changed to a simple search
 * by overriding `getSuggestions`
 * `targetMatch` is a regex that finds the part of the input to use as a search term
 * It should provide two groups: the first one is left alone, the second one is the
 * search term, and is replaced by the result of the suggestions. By default, it's
 * a comma separator.
 * 
 */
abstract class AddTextSuggest extends AbstractInputSuggest<string> {
    content: string[];
    targetMatch = /^(.*),\s*([^,]*)/


    constructor(private inputEl: HTMLInputElement, app: App, private onSelectCb: (value: string) => void = (v)=>{}) {
        super(app, inputEl);
        this.content = this.getContent();
    }

    getSuggestions(inputStr: string): string[] {
		return this.doFuzzySearch(this.getParts(inputStr)[1]);
    }

    /*
     * Returns the bit at the beginning to ignore [0] and the target bit [1]
     */
    getParts(input:string) : [string,string] {
        const m = input.match(this.targetMatch)
        if(m) {
            return [m[1],m[2]]
        } else {
            return ["",input]
        }
    }

    doSimpleSearch(target:string) : string[] {
        if( ! target || target.length < 2 ) return []
        //fuzzySearch
        const lowerCaseInputStr = target.toLocaleLowerCase();
        const t = this.content.filter((content) =>
            content.toLocaleLowerCase().contains(lowerCaseInputStr)
        );
        return t
    }

    //TODO: Check this function
    doFuzzySearch(target: string, maxResults = 20, minScore = -2): string[] {
        if (!target || target.length < 2) return []

        const fuzzy = prepareFuzzySearch(target)

        return this.content
            .flatMap((content): [string, SearchResult][] => {
                const result = fuzzy(content)
                return result ? [[content, result]] : []
            })
            .filter(([, result]) => result.score > minScore)
            .sort(([, a], [, b]) => b.score - a.score)
            .map(([c]) => c)
            .slice(0, maxResults)
    }

    renderSuggestion(content: string, el: HTMLElement): void {
        el.setText(content);
    }

    selectSuggestion(content: string, _evt: MouseEvent | KeyboardEvent): void {
        const [head,_tail] = this.getParts(this.inputEl.value)
        //console.log(`Got '${head}','${tail}' from `, this.inputEl.value)
        if( head.length > 0 ) {
            this.onSelectCb(head + ", "+content);
            this.inputEl.value = head + ", " +this.wrapContent(content)
        }
        else {
            this.onSelectCb(content);
            this.inputEl.value = this.wrapContent(content) 
        }
        this.inputEl.dispatchEvent(new Event("change"))
        this.inputEl.setSelectionRange(0, 1)
        this.inputEl.setSelectionRange(this.inputEl.value.length,this.inputEl.value.length)
        this.inputEl.focus()
        this.close();
    }

    wrapContent(content:string):string {
        return content
    }

    abstract getContent(): string[];

}

export class TagSuggest extends AddTextSuggest {
	getContent() {
		// @ts-expect-error - this is an undocumented function...
		const tagMap:Map<string,any> = this.app.metadataCache.getTags();
        return Object.keys(tagMap).map((k)=>k.replace("#",""))
	  }
}

export class LinkSuggest extends AddTextSuggest {
	getContent() {
        return this.app.vault.getFiles().filter((f)=>f.extension === "md").map((f)=>f.basename)
    }

    getSuggestions(inputStr: string): string[] {
		const target = this.getParts(inputStr)[1];
        const m = target.match(/\s*\[\[(.*)/);
        if( ! m || m.length < 2 || m[1].length < 1) return []
        //console.log(m)
        const newTarget = m[1]
        //console.log("Got newTarget ",newTarget," from  ",target)
		return this.doFuzzySearch(newTarget)
    }

    wrapContent(content:string):string {
        return `[[${content}]]`
    }
}

/* Experiment towards making a UI that turns suggestions in to visually distinct elements
export class ContentEditableTest extends Modal {
    editDiv:HTMLDivElement

    async onOpen() {
		let {contentEl} = this; 
        contentEl.createEl("h4",{text:"ContentEditable"})
        this.editDiv = contentEl.createEl("div",{text:"Edit me"})
        this.editDiv.setAttribute("contenteditable","true")
        this.addElement("hello","from-template-text-completion-a")
        this.addElement("there","from-template-text-completion-b")

    }

    addElement(tx:string, cls:string) {
        const el = this.editDiv.createSpan(cls)
        el.setText(tx)
        const but = el.createEl("button")
        but.setText("X")
        but.onclick = () => el.detach()
    }
}
*/
