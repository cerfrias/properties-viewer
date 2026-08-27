import * as vscode from 'vscode';
import { PropertiesEditorProvider } from './propertiesEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(PropertiesEditorProvider.register(context));
}

export function deactivate() {}