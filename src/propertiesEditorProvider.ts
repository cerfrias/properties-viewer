import * as vscode from 'vscode';
import htmlTemplate from './webview/index.html';

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

    // 1. Renderizar el HTML inicial del Webview
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    // 2. Enviar el contenido inicial parseado al Webview
    const updateWebview = () => {
      const text = document.getText();
      const entries = this.parseProperties(text);
      webviewPanel.webview.postMessage({
        type: 'UPDATE_CONTENT',
        entries,
      });
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
          this.applyEdit(document, message.key, message.value);
          break;
      }
    });

    updateWebview();
  }

  private parseProperties(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
        continue;
      }

      const separatorIdx = line.search(/[=:]/);
      if (separatorIdx !== -1) {
        const key = line.slice(0, separatorIdx).trim();
        const value = line.slice(separatorIdx + 1).trim();
        result[key] = value;
      }
    }
    return result;
  }

  private applyEdit(document: vscode.TextDocument, key: string, newValue: string) {
    // Aplica cambios mediante WorkspaceEdit para mantener soporte de Undo/Redo
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    // Reconstrucción del texto (para implementaciones avanzadas, haz edits por línea/rango)
    const current = this.parseProperties(document.getText());
    current[key] = newValue;
    const newContent = Object.entries(current)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    edit.replace(document.uri, fullRange, newContent);
    vscode.workspace.applyEdit(edit);
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