import * as vscode from 'vscode';
import htmlTemplate from './webview/index.html';

class Pair<A, B> {
    constructor(public first: A, public second: B) {}
}

type LineType = string | Pair<string, string>;

class Properties {
    private lines: LineType[];
    private document: vscode.TextDocument;
    private editQueue: EditQueue;
    public addedSinceLastUpdate = false;

    private constructor(lines: LineType[], editQueue: EditQueue, document: vscode.TextDocument) {
        this.lines = lines;
        this.editQueue = editQueue;
        this.document = document;
    }

    public static async parse(document: vscode.TextDocument, editQueue: EditQueue) {
        console.log(`parsing ${document.uri}`);

        const text = document.getText();
        const rawLines = text.split(/\r?\n/);
        const parsedLines: LineType[] = [];

        // Rangos [startLineNo, endLineNo] (líneas físicas originales) que hay que
        // colapsar a una sola línea en el documento, con el texto ya combinado.
        const collapseEdits: { startLineNo: number; endLineNo: number; flattened: string }[] = [];

        let i = 0;
        while (i < rawLines.length) {
            const startLineNo = i;
            let line = rawLines[i];
            const trimmed = line.trim();

            // Comentarios y líneas vacías nunca tienen continuación
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
                parsedLines.push(line);
                i++;
                continue;
            }

            let combined = line;
            let endLineNo = startLineNo;

            // Mientras la línea actual termine en '\' no escapado, únela con la siguiente
            while (
                /(?<!\\)(\\\\)*\\$/.test(combined) &&
                endLineNo + 1 < rawLines.length
            ) {
                endLineNo++;
                const next = rawLines[endLineNo];
                // Quita la barra final y concatena, recortando espacios de cabecera
                // de la línea continuada (comportamiento estándar de .properties)
                combined = combined.slice(0, -1) + next.replace(/^\s+/, '');
            }

            const separatorMatch = /(?<!\\)[=:]/.exec(combined);
            if (separatorMatch) {
                const separatorIdx = separatorMatch.index;
                const key = combined.slice(0, separatorIdx);
                const value = combined.slice(separatorIdx + 1);
                parsedLines.push(new Pair(key, value));
            } else {
                parsedLines.push(combined);
            }

            // Si abarcaba más de una línea física, hay que normalizar el documento
            if (endLineNo > startLineNo) {
                collapseEdits.push({ startLineNo, endLineNo, flattened: combined });
            }

            i = endLineNo + 1;
        }

        // Si había entradas multilínea, reescribimos el documento para que
        // pasen a ocupar una única línea física, y así garantizamos que
        // this.lines vuelve a alinearse 1:1 con las líneas del documento
        // tan pronto como este edit se aplique.
        if (collapseEdits.length > 0) {
            const edit = new vscode.WorkspaceEdit();

            for (const { startLineNo, endLineNo, flattened } of collapseEdits) {
                const range = new vscode.Range(
                    new vscode.Position(startLineNo, 0),
                    document.lineAt(endLineNo).range.end
                );
                edit.replace(document.uri, range, flattened);
            }

            console.log(`normalizing ${collapseEdits.length} multiline entr${collapseEdits.length === 1 ? 'y' : 'ies'} in ${document.uri}`);

            await editQueue.push(() => edit);

            console.log(`parsed ${document.uri}`);
        }

        return new Properties(parsedLines, editQueue, document);
    }

    public editKey(lineIdx: number, newKey: string): void {
        if (lineIdx < 0 || lineIdx >= this.lines.length) { return; }
        const entry = this.lines[lineIdx];
        if (!(entry instanceof Pair)) { return; }
        const line = entry;

        const leadingSpaces = line.first.length - line.first.trimStart().length;
        const trailingSpaces = line.first.length - line.first.trimEnd().length;
        const keyStart = leadingSpaces;
        const keyEnd = line.first.length - trailingSpaces;

        const range = new vscode.Range(
            new vscode.Position(lineIdx, keyStart),
            new vscode.Position(lineIdx, keyEnd)
        );

        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.document.uri, range, newKey);

        // Conserva los espacios de cabecera/cola originales alrededor de la nueva clave
        line.first =
            line.first.slice(0, leadingSpaces) +
            newKey +
            line.first.slice(line.first.length - trailingSpaces);

        this.editQueue.push(() => edit);
    }

    public editValue(lineIdx: number, newValue: string): void {
        if (lineIdx < 0 || lineIdx >= this.lines.length) { return; }
        console.log(`editing ${lineIdx} value -> ${newValue}`);
        const line = this.lines[lineIdx] as Pair<string, string>;

        const valueStart = line.first.length + 1;
        const valueEnd = valueStart + line.second.length;

        const range = new vscode.Range(
            new vscode.Position(lineIdx, valueStart),
            new vscode.Position(lineIdx, valueEnd)
        );

        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.document.uri, range, newValue);

        line.second = newValue;

        this.editQueue.push(() => edit);
    }

    public addKey(key: string, value: string, separator: string = '='): Promise<boolean> {
        console.log(`adding ${key}${separator}${value}`);
        this.addedSinceLastUpdate = true;

        const newPair = new Pair(key, value);
        this.lines.push(newPair);

        return this.editQueue.push(() => {
            const lastLineIndex = Math.max(0, this.document.lineCount - 1);
            const lastLine = this.document.lineAt(lastLineIndex);

            const textToInsert = (lastLine.text.length > 0 ? '\n' : '') + `${key}${separator}${value}`;
            const edit = new vscode.WorkspaceEdit();
            edit.insert(this.document.uri, lastLine.range.end, textToInsert);

            return edit;
        });
    }

    public editComment(lineIdx: number, value: string): void {
        if (lineIdx < 0 || lineIdx >= this.lines.length) { return; }
        console.log(`editing ${lineIdx} comment -> ${value}`);

        let lineRange = this.document.lineAt(lineIdx).range;

        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.document.uri, lineRange, value);

        this.lines[lineIdx] = value;

        this.editQueue.push(() => edit);

    }

    public addComment(comment: string): Promise<boolean> {
        console.log(`adding comment ${comment}`);
        this.addedSinceLastUpdate = true;

        this.lines.push(comment);

        return this.editQueue.push(() => {
            const lastLineIndex = Math.max(0, this.document.lineCount - 1);
            const lastLine = this.document.lineAt(lastLineIndex);

            const textToInsert = (lastLine.text.length > 0 ? `\n` : "") + comment;
            const edit = new vscode.WorkspaceEdit();
            edit.insert(this.document.uri, lastLine.range.end, textToInsert);
            return edit;
        });
    }

    public deleteLine(lineIdx: number): void {
        if (lineIdx < 0 || lineIdx >= this.lines.length) { return; }
        console.log(`deleting ${lineIdx}`);
        // Seleccionamos la línea entera, incluyendo el salto de línea para no dejar huecos
        let lineRange = this.document.lineAt(lineIdx).rangeIncludingLineBreak;
        if (lineIdx > 0 && lineIdx === this.lines.length - 1) {
            lineRange = new vscode.Range(
                this.document.lineAt(lineIdx - 1).range.end,
                lineRange.end
            );
        }
        const edit = new vscode.WorkspaceEdit();
        edit.delete(this.document.uri, lineRange);

        // Actualizamos el estado interno
        this.lines.splice(lineIdx, 1);

        this.editQueue.push(() => edit);
    }

    public moveEntry(sourceIdx: number, targetIdx: number, insertAfter: boolean): void {
        console.log(`moving ${sourceIdx} -> ${targetIdx}`);
        if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) { return; }

        const finalTargetIdx = insertAfter ? targetIdx + 1 : targetIdx;
        const sourceLine = this.document.lineAt(sourceIdx);
        const textToMove = sourceLine.text;

        const edit = new vscode.WorkspaceEdit();

        // 1. Borrar la línea original
        let delRange = sourceLine.rangeIncludingLineBreak;
        if (sourceIdx > 0 && sourceIdx === this.lines.length - 1) {
            delRange = new vscode.Range(
                this.document.lineAt(sourceIdx - 1).range.end,
                delRange.end
            );
        }
        edit.delete(this.document.uri, delRange);

        // 2. Insertar en el nuevo destino
        if (finalTargetIdx >= this.lines.length) {
            // Si va al final del archivo, lo añadimos detrás de la última línea
            const lastLine = this.document.lineAt(this.document.lineCount - 1);
            edit.insert(this.document.uri, lastLine.range.end, '\n' + textToMove);
        } else {
            // Si va entre medias, lo insertamos al principio de la línea objetivo
            edit.insert(this.document.uri, new vscode.Position(finalTargetIdx, 0), textToMove + '\n');
        }

        // 3. Actualizar la matriz interna para mantener la consistencia en el backend
        const [moved] = this.lines.splice(sourceIdx, 1);
        let arrayInsertIdx = finalTargetIdx;
        if (sourceIdx < finalTargetIdx) { arrayInsertIdx--; } // Ajuste tras borrar el source
        this.lines.splice(arrayInsertIdx, 0, moved);

        this.editQueue.push(() => edit);
    }

    public entries(): [number, string, string][] {
        const result: [number, string, string][] = [];

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            if (line instanceof Pair) {
                result.push([i, line.first.trim(), line.second.trim()]);
            } else {
                result.push([i, `#`, line.trim()]);
            }
        }
        return result;
    }
}

type EditTask = () => Thenable<boolean>;

class EditQueue {
    private queue: EditTask[] = [];
    private consuming: boolean = false;

    public push(edit: () => vscode.WorkspaceEdit): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const res = await vscode.workspace.applyEdit(edit());
                    resolve(res);
                    return res;
                } catch (err) {
                    console.error('applyEdit failed', err);
                    reject(err);
                    return false;
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

        const editQueue = new EditQueue();

        let properties = await Properties.parse(document, editQueue);

        // 1. Renderizar el HTML inicial del Webview
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // 2. Enviar el contenido inicial parseado al Webview
        let updateChain: Promise<void> = Promise.resolve();

        const updateWebview = () => {
            updateChain = updateChain.then(async () => {
                const wasAdded = properties.addedSinceLastUpdate;
                properties = await Properties.parse(document, editQueue);
                webviewPanel.webview.postMessage({
                    type: wasAdded ? 'ADDED' : 'UPDATE_CONTENT',
                    entries: properties.entries(),
                });
            }).catch(err => console.error('updateWebview failed', err));
        };

        // 3. Escuchar cambios si el archivo cambia externamente o por Undo/Redo
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async (e) => {
            if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
                updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // 4. Escuchar modificaciones hechas por el usuario dentro del Webview
        webviewPanel.webview.onDidReceiveMessage((message) => {
            try {
                switch (message.type) {
                    case 'UPDATE_ENTRY':
                        properties.editValue(message.lineIdx, message.value);
                        break;
                    case 'UPDATE_KEY':
                        properties.editKey(message.lineIdx, message.newKey);
                        break;
                    case 'ADD_ENTRY':
                        properties.addKey(message.key, message.value).catch(err =>
                            console.error('addKey failed', err));
                        break;
                    case 'DELETE_LINE':
                        properties.deleteLine(message.lineIdx);
                        break;
                    case 'UPDATE_COMMENT':
                        properties.editComment(message.lineIdx, message.value);
                        break;
                    case 'ADD_COMMENT':
                        properties.addComment(message.comment).catch(err =>
                            console.error('addComment failed', err));
                        break;
                    case 'MOVE_ENTRY':
                        properties.moveEntry(message.sourceIdx, message.targetIdx, message.insertAfter);
                        break;
                }
            } catch (err) {
                console.error('Error handling webview message', err);
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