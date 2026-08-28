import * as vscode from 'vscode';
import htmlTemplate from './webview/index.html';

class Pair<A, B> {
    constructor(public first: A, public second: B) {}
}

type LineType = string | Pair<string, string>;

class Properties {
    private lines: LineType[];
    private document: vscode.TextDocument;
    private editQueue = new EditQueue();

    constructor(lines: LineType[], document: vscode.TextDocument) {
        this.lines = lines;
        this.document = document;
    }

    public static parse(document: vscode.TextDocument): Properties {
        const text = document.getText();
        const parsedLines: LineType[] = [];
        const rawLines = text.split(/\r?\n/);

        for (const line of rawLines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
                parsedLines.push(line);
                continue;
            }

            const separatorMatch = /(?<!\\)[=:]/.exec(line);
            if (separatorMatch) {
                const separatorIdx = separatorMatch.index;
                const key = line.slice(0, separatorIdx);
                const value = line.slice(separatorIdx + 1);
                parsedLines.push(new Pair(key, value));
            } else {
                parsedLines.push(line);
            }
        }

        return new Properties(parsedLines, document);
    }

    public editKey(oldKey: string, newKey: string): void {
        const targetKey = oldKey.trim();

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            if (line instanceof Pair && line.first.trim() === targetKey) {
                const leadingSpaces = line.first.length - line.first.trimStart().length;
                const keyStart = leadingSpaces;
                const keyEnd = leadingSpaces + line.first.trim().length;

                const range = new vscode.Range(
                    new vscode.Position(i, keyStart),
                    new vscode.Position(i, keyEnd)
                );

                const edit = new vscode.WorkspaceEdit();
                edit.replace(this.document.uri, range, newKey);

                line.first = line.first.slice(0, leadingSpaces) + newKey;

                this.editQueue.push(() => vscode.workspace.applyEdit(edit));
            }
        }
    }

    public editValue(key: string, newValue: string): void {
        const targetKey = key.trim();

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            if (line instanceof Pair && line.first.trim() === targetKey) {
                const valueStart = line.first.length + 1;
                const valueEnd = valueStart + line.second.length;

                const range = new vscode.Range(
                    new vscode.Position(i, valueStart),
                    new vscode.Position(i, valueEnd)
                );

                const edit = new vscode.WorkspaceEdit();
                edit.replace(this.document.uri, range, newValue);

                line.second = newValue;

                this.editQueue.push(() => vscode.workspace.applyEdit(edit));
            }
        }
    }

    public addKey(key: string, value: string, separator: string = '='): Promise<boolean> {
        addedKeySinceLastUpdate = true;

        const newPair = new Pair(key, value);
        this.lines.push(newPair);

        return this.editQueue.push(() => {
            const lastLineIndex = Math.max(0, this.document.lineCount - 1);
            const lastLine = this.document.lineAt(lastLineIndex);

            const textToInsert = (lastLine.text.length > 0 ? '\n' : '') + `${key}${separator}${value}`;
            const edit = new vscode.WorkspaceEdit();
            edit.insert(this.document.uri, lastLine.range.end, textToInsert);

            return vscode.workspace.applyEdit(edit);
        });
    }

    public deleteKey(key: string): void {
        const targetKey = key.trim();

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            // Solo borramos si es un par Key-Value (ignoramos comentarios de momento)
            if (line instanceof Pair && line.first.trim() === targetKey) {
                // Seleccionamos la línea entera, incluyendo el salto de línea para no dejar huecos
                let lineRange = this.document.lineAt(i).rangeIncludingLineBreak;
                if (i === this.lines.length - 1) {
                    lineRange = new vscode.Range(
                        this.document.lineAt(i - 1).range.end,
                        lineRange.end
                    );
                }
                const edit = new vscode.WorkspaceEdit();
                edit.delete(this.document.uri, lineRange);

                // Actualizamos el estado interno
                this.lines.splice(i, 1);

                this.editQueue.push(() => vscode.workspace.applyEdit(edit));
                break;
            }
        }
    }

    public entries(): Record<string, string> {
        const result: Record<string, string> = {};
        let comment = 0;

        for (const line of this.lines) {
            if (line instanceof Pair) {
                result[line.first.trim()] = line.second.trim();
            } else {
                result[`#${comment}`] = line.trim();
                comment++;
            }
        }
        return result;
    }
}

type EditTask = () => Thenable<boolean>;

class EditQueue {
    private queue: EditTask[] = [];
    private consuming: boolean = false;

    public push(task: EditTask): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const res = await task();
                    resolve(res);
                    return res;
                } catch (err) {
                    reject(err);
                    throw err;
                }
            });
            this.consume();
        });
    }

    private async consume() {
        if (this.consuming) { return; }
        this.consuming = true;

        try {
            while (this.queue.length > 0) {
                const task = this.queue.shift()!;
                await task();
            }
        } finally {
            this.consuming = false;
        }
    }
}

let addedKeySinceLastUpdate = false;

export class PropertiesEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new PropertiesEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            'propertiesCustom.editor',
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        let properties = Properties.parse(document);

        // 1. Renderizar el HTML inicial del Webview
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // 2. Enviar el contenido inicial parseado al Webview
        const updateWebview = () => {
            // DEBE PARSEARSE SIEMPRE PARA RECUPERAR EL ESTADO REAL (VITAL PARA UNDO)
            properties = Properties.parse(document);
            webviewPanel.webview.postMessage({
                type: addedKeySinceLastUpdate ? 'ADDED_KEY' : 'UPDATE_CONTENT',
                entries: properties.entries(),
            });
            addedKeySinceLastUpdate = false;
        };

        // 3. Escuchar cambios si el archivo cambia externamente o por Undo/Redo
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
                updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // 4. Escuchar modificaciones hechas por el usuario dentro del Webview
        webviewPanel.webview.onDidReceiveMessage((message) => {
            switch (message.type) {
                case 'UPDATE_ENTRY':
                    properties.editValue(message.key, message.value);
                    break;
                case 'UPDATE_KEY':
                    properties.editKey(message.oldKey, message.newKey);
                    break;
                case 'ADD_ENTRY':
                    properties.addKey(message.key, message.value);
                    break;
                case 'DELETE_ENTRY':
                    properties.deleteKey(message.key);
                    break;
            }
        });

        updateWebview();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
        );
        const nonce = getNonce();

        // Reemplazamos los placeholders en el string importado
        return htmlTemplate
            .replaceAll('{{cspSource}}', webview.cspSource)
            .replaceAll('{{nonce}}', nonce)
            .replaceAll('{{styleUri}}', styleUri.toString())
            .replaceAll('{{scriptUri}}', scriptUri.toString());
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}