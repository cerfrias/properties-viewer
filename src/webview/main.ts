import './style.css';
import hljs from 'highlight.js';
import 'highlight.js/styles/vs2015.css';

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
};

const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;
const addBtn = document.getElementById('add-btn')!;

addBtn.addEventListener('click', (e) => {
    // Generamos una clave única.
    const uniqueKey = `new_key_${Math.floor(Math.random() * 10000)}`;
    vscode.postMessage({ type: 'ADD_ENTRY', key: uniqueKey, value: '' });
});

interface timeoutMDKey {
    id: number;
    type: "KEY";
    oldKey: string;
    newKey: string;
}

interface timeoutMDValue {
    id: number;
    type: "VALUE";
    key: string;
    value: string;
}

type tmType = "KEY" | "VALUE";

// --- 1. TimeoutManager optimizado ---
class timeoutManager {
    private timeoutskey = new Map<string, timeoutMDKey>();
    private timeoutsvalue = new Map<string, timeoutMDValue>();

    constructor() {}

    private set(type: "KEY", tmId: number, oldKey: string, newKey: string): void;
    private set(type: "VALUE", tmId: number, key: string, value: string): void;
    private set(type: tmType, tmId: number, name: string, arg: string) {
        if (type === "KEY") {
            this.timeoutskey.set(name, { id: tmId, type, oldKey: name, newKey: arg });
        } else {
            this.timeoutsvalue.set(name, { id: tmId, type, key: name, value: arg });
        }
    }

    public rename(originalKey: string, newKey: string) {
        clearTimeout(this.timeoutskey.get(originalKey)?.id);

        // Migramos los guardados pendientes del valor de la clave vieja a la nueva
        const oldtm = this.timeoutsvalue.get(originalKey);
        if (oldtm) {
            clearTimeout(oldtm.id);
            this.timeoutsvalue.delete(originalKey);
            this.save(newKey, oldtm.value);
        }

        this.set("KEY",
            window.setTimeout(() => {
                vscode.postMessage({ type: 'UPDATE_KEY', oldKey: originalKey, newKey });
            }, 400),
            originalKey,
            newKey
        );
    }

    public save(key: string, value: string) {
        clearTimeout(this.timeoutsvalue.get(key)?.id);
        this.set("VALUE",
            window.setTimeout(() => {
                vscode.postMessage({ type: 'UPDATE_ENTRY', key, value });
            }, 300),
            key,
            value
        );
    }
}

const TM = new timeoutManager();

// --- 2. renderTable y eventos del Input ajustados ---
function renderTable(entries: Record<string, string>) {
    app.innerHTML = `
    <table>
      <thead>
        <tr><th>Key</th><th>Value</th><th></th></tr>
      </thead>
      <tbody>
        ${Object.entries(entries).map(([k, v]) => {
        const displayValue = unescapeValue(v);
        let textToHighlight = displayValue;
        if (textToHighlight.endsWith('\n')) { textToHighlight += ' '; }

        const result = hljs.highlightAuto(textToHighlight);
        const highlightedText = result.value || escapeHtml(textToHighlight);

        return `
            <tr data-rowkey="${k}">
              ${k.startsWith("#") ?
                `
                <td colspan="2" class="comment-cell">
                  <input class="comment-input" type="text" value="${escapeHtml(displayValue)}" readonly>
                </td>
                <td></td>
                `
                :
                `
                <td><input type="text" data-key="${k}" value="${k}"></td>
                <td>
                  <div class="editor-wrapper">
                    <textarea data-key="${k}" spellcheck="false" rows="1">${escapeHtml(displayValue)}</textarea>
                    <pre aria-hidden="true"><code class="hljs ${result.language || ''}">${highlightedText}</code></pre>
                  </div>
                </td>
                <td class="action-cell">
                  <button class="delete-btn" data-key="${k}" title="Delete Row">✕</button>
                </td>
                `
            }
            </tr>
          `;
    }).join('')}
      </tbody>
    </table>
  `;


    app.querySelectorAll('textarea').forEach((ta: HTMLTextAreaElement) => {
        // ... (Tu código del textarea con document.execCommand y Undo se mantiene exactamente igual) ...
        ta.addEventListener('keydown', (e: Event) => {
            const keyboardEvent = e as KeyboardEvent;
            const isMac = navigator.platform.toUpperCase().includes('MAC');
            const modifier = isMac ? keyboardEvent.metaKey : keyboardEvent.ctrlKey;

            if (modifier && keyboardEvent.key.toLowerCase() === 'z') {
                keyboardEvent.preventDefault();
                keyboardEvent.stopPropagation();
                if (keyboardEvent.shiftKey) { document.execCommand('redo'); }
                else { document.execCommand('undo'); }
                return;
            }
            if (modifier && keyboardEvent.key.toLowerCase() === 'y') {
                keyboardEvent.preventDefault();
                keyboardEvent.stopPropagation();
                document.execCommand('redo');
                return;
            }
            if (keyboardEvent.key === 'Tab') {
                keyboardEvent.preventDefault();
                document.execCommand('insertText', false, '\t');
            }
        });

        ta.addEventListener('input', () => {
            syncHighlight(ta);
            TM.save(ta.dataset.key!, escapeValue(ta.value));
        });
    });

    app.querySelectorAll('input[type="text"]:not(.comment-input)').forEach((ti: Element) => {
        const inputEl = ti as HTMLInputElement;

        // Al enfocar, guardamos la clave inicial para el renombrado
        inputEl.addEventListener('focus', () => {
            inputEl.dataset.original = inputEl.value;
        });

        inputEl.addEventListener('input', () => {
            const original = inputEl.dataset.original!;
            const next = inputEl.value;
            const current = inputEl.dataset.current || original;

            // Actualizamos la referencia interna del textarea que le acompaña
            const ta = app.querySelector(`textarea[data-key="${current}"]`) as HTMLTextAreaElement;
            if (ta) { ta.dataset.key = next; }

            inputEl.dataset.key = next;
            inputEl.dataset.current = next;

            // Siempre enviamos el renombrado desde la clave original a la actual
            TM.rename(original, next);
        });

        inputEl.addEventListener('blur', () => {
            inputEl.dataset.original = inputEl.value;
            delete inputEl.dataset.current;
        });
    });

    app.querySelectorAll('.delete-btn').forEach((btn: Element) => {
        btn.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const keyToDelete = target.getAttribute('data-key');
            if (keyToDelete) {
                vscode.postMessage({ type: 'DELETE_ENTRY', key: keyToDelete });
            }
        });
    });

}

// --- 3. updateTable protegiendo el foco ---
function updateTable(entries: Record<string, string>) {
    // 1. Recogemos las claves basándonos en las filas (incluye comentarios)
    const currentKeys = Array.from(app.querySelectorAll('tr[data-rowkey]')).map(tr => (tr as HTMLElement).dataset.rowkey);
    const newKeys = Object.keys(entries);

    const activeEl = document.activeElement;
    // Comprobamos si estás escribiendo en CUALQUIER campo interactivo
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

    if (currentKeys.join(',') !== newKeys.join(',')) {
        // Si estás escribiendo y la cantidad de filas es igual (ej. renombrando una clave),
        // ignoramos el render para no robarte el cursor.
        if (isTyping && currentKeys.length === newKeys.length) {
            // Ignoramos la actualización visual
        } else {
            // Si has borrado/añadido filas desde VS Code, o has hecho un Undo general
            renderTable(entries);
            return;
        }
    }

    Object.entries(entries).forEach(([k, v]) => {
        // Si es un comentario, podemos obviar el textarea
        if (k.startsWith("#")) {
            return;
        }

        const ta = app.querySelector(`textarea[data-key="${k}"]`) as HTMLTextAreaElement;
        if (ta) {
            const displayValue = unescapeValue(v);
            if (ta.value !== displayValue) {
                // Bloqueamos los ecos de VS Code mientras escribimos en el valor
                if (document.activeElement === ta) { return; }
                ta.value = displayValue;
                syncHighlight(ta);
            }
        }

        // Si VS Code manda un cambio de clave por Undo, actualizamos el input si no lo estamos tocando
        const inputEl = app.querySelector(`input[data-key="${k}"]`) as HTMLInputElement;
        if (inputEl && inputEl.value !== k && document.activeElement !== inputEl) {
            inputEl.value = k;
        }
    });
}

window.addEventListener('message', (event: MessageEvent) => {
    switch (event.data.type) {
        case 'UPDATE_CONTENT':
            updateTable(event.data.entries);
            break;
        case 'ADDED_KEY':
            updateTable(event.data.entries);
            addBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            break;
    }

});

function unescapeValue(val: string): string {
    try { return JSON.parse(`"${val.replace(/"/g, '\\"')}"`); } catch { return val; }
}

function escapeValue(val: string): string {
    return JSON.stringify(val).slice(1, -1).replace(/\\"/g, '"');
}

function escapeHtml(unsafe: string) {
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function syncHighlight(ta: HTMLTextAreaElement) {
    let textForHljs = ta.value;
    if (textForHljs.endsWith('\n')) { textForHljs += ' '; }

    const result = hljs.highlightAuto(textForHljs);
    const highlighted = result.value || escapeHtml(textForHljs);

    const wrapper = ta.closest('.editor-wrapper');
    const codeBlock = wrapper?.querySelector('code');
    if (codeBlock) {
        codeBlock.className = `hljs ${result.language || ''}`;
        codeBlock.innerHTML = highlighted;
    }
}