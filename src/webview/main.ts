import './style.css';
import hljs from 'highlight.js';
import 'highlight.js/styles/vs2015.css';

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
};

const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;
const addBtn = document.getElementById('add-btn')!;
const addCommentBtn = document.getElementById('add-comment-btn')!;

addBtn.addEventListener('click', (e) => {
    // Generamos una clave única.
    const uniqueKey = `new_key_${Math.floor(Math.random() * 10000)}`;
    vscode.postMessage({ type: 'ADD_ENTRY', key: uniqueKey, value: '' });
});

addCommentBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'ADD_COMMENT', comment: "# " });
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

interface timeoutMDComment {
    id: number;
    type: "COMMENT";
    commentKey: string;
    newValue: string;
}

type tmType = "KEY" | "VALUE" | "COMMENT";

// --- 1. TimeoutManager optimizado ---
class timeoutManager {
    private timeoutskey = new Map<string, timeoutMDKey>();
    private timeoutsvalue = new Map<string, timeoutMDValue>();
    private timeoutscomment = new Map<string, timeoutMDComment>();

    constructor() {}

    private set(type: "KEY", tmId: number, oldKey: string, newKey: string): void;
    private set(type: "VALUE", tmId: number, key: string, value: string): void;
    private set(type: "COMMENT", tmId: number, commentKey: string, newValue: string): void;
    private set(type: tmType, tmId: number, name: string, arg: string) {
        if (type === "KEY") {
            this.timeoutskey.set(name, { id: tmId, type, oldKey: name, newKey: arg });
        } else if (type === "VALUE") {
            this.timeoutsvalue.set(name, { id: tmId, type, key: name, value: arg });
        } else {
            this.timeoutscomment.set(name, { id: tmId, type, commentKey: name, newValue: arg });
        }
    }

    public renameKey(originalKey: string, newKey: string) {
        clearTimeout(this.timeoutskey.get(originalKey)?.id);

        // Migramos los guardados pendientes del valor de la clave vieja a la nueva
        const oldtm = this.timeoutsvalue.get(originalKey);
        if (oldtm) {
            clearTimeout(oldtm.id);
            this.timeoutsvalue.delete(originalKey);
            this.saveValue(newKey, oldtm.value);
        }

        this.set("KEY",
            window.setTimeout(() => {
                vscode.postMessage({ type: 'UPDATE_KEY', oldKey: originalKey, newKey });
            }, 400),
            originalKey,
            newKey
        );
    }

    public saveValue(key: string, value: string) {
        clearTimeout(this.timeoutsvalue.get(key)?.id);
        this.set("VALUE",
            window.setTimeout(() => {
                vscode.postMessage({ type: 'UPDATE_ENTRY', key, value });
            }, 300),
            key,
            value
        );
    }

    public saveComment(commentIdx: string, newValue: string) {

        clearTimeout(this.timeoutscomment.get(commentIdx)?.id);

        this.set("COMMENT",
            window.setTimeout(() => {
                vscode.postMessage({ type: 'UPDATE_COMMENT', commentIdx, newValue });
            }, 300),
            commentIdx,
            newValue
        );
    }
}

const TM = new timeoutManager();

// --- 2. renderTable y eventos del Input ajustados ---
function renderTable(entries: Record<string, string>) {
    app.innerHTML = `
    <table>
      <thead>
        <tr><th></th><th>Key</th><th>Value</th><th></th></tr>
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
              <!-- Manillar de arrastre común para toda la fila -->
              <td class="drag-handle" data-key="${k}">⠿</td>
            
              ${k.startsWith("#") ?
                `
                <!-- Comentario con colspan="2" para ocupar el ancho de Key y Value -->
                <td colspan="2" class="comment-cell">
                  <input class="comment-input" data-commentkey="${k}" type="text" value="${escapeHtml(displayValue)}">
                </td>
                <td class="action-cell">
                  <button class="delete-btn" data-commentkey="${k}" title="Delete Row">✕</button>
                </td>
                `
                :
                `
                <!-- Fila normal de Key / Value -->
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
            TM.saveValue(ta.dataset.key!, escapeValue(ta.value));
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
            TM.renameKey(original, next);
        });

        inputEl.addEventListener('blur', () => {
            inputEl.dataset.original = inputEl.value;
            delete inputEl.dataset.current;
        });
    });

    app.querySelectorAll('input[type="text"].comment-input').forEach((tie) => {
        const ti = tie as HTMLInputElement;

        ti.addEventListener('keydown', (e: Event) => {
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
        });

        ti.addEventListener('input', () => {
            TM.saveComment(ti.dataset.commentkey!, escapeValue(ti.value));
        });
    });

    app.querySelectorAll('.delete-btn').forEach((btn: Element) => {
        btn.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const keyToDelete = target.dataset.key;
            if (keyToDelete) {
                vscode.postMessage({ type: 'DELETE_ENTRY', key: keyToDelete });
            } else {
                vscode.postMessage({ type: 'DELETE_COMMENT', commentIdx: target.dataset.commentkey });
            }
        });
    });

    setupDragAndDrop();
}

// --- 3. updateTable protegiendo el foco ---
function updateTable(entries: Record<string, string>) {
    const currentKeys = Array.from(app.querySelectorAll('tr[data-rowkey]')).map(tr => (tr as HTMLElement).dataset.rowkey);
    const newKeys = Object.keys(entries);

    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

    if (currentKeys.join(',') !== newKeys.join(',')) {
        if (isTyping && currentKeys.length === newKeys.length) {
            // Ignoramos la actualización visual para no robar foco en el renombrado
        } else {
            renderTable(entries);
            return;
        }
    }

    Object.entries(entries).forEach(([k, v]) => {
        const displayValue = unescapeValue(v);

        // 1. Lógica para COMENTARIOS
        if (k.startsWith("#")) {
            const commentInput = app.querySelector(`input[data-commentkey="${k}"]`) as HTMLInputElement;
            if (commentInput && commentInput.value !== displayValue) {
                // Protegemos el foco si el usuario está escribiendo justo en este comentario
                if (document.activeElement === commentInput) { return; }
                commentInput.value = displayValue;
            }
            return;
        }

        // 2. Lógica para VALORES (Textarea)
        const ta = app.querySelector(`textarea[data-key="${k}"]`) as HTMLTextAreaElement;
        if (ta && ta.value !== displayValue) {
            if (document.activeElement === ta) { return; }
            ta.value = displayValue;
            syncHighlight(ta);
        }

        // 3. Lógica para CLAVES (Input) - (Usado en el Undo general)
        const inputEl = app.querySelector(`input[data-key="${k}"]`) as HTMLInputElement;
        if (inputEl && inputEl.value !== k && document.activeElement !== inputEl) {
            inputEl.value = k;
        }
    });
}

// Función independiente para manejar el Drag and Drop
function setupDragAndDrop() {
    app.querySelectorAll('tr[data-rowkey]').forEach(tr => {
        const row = tr as HTMLTableRowElement;
        const handle = row.querySelector('.drag-handle') as HTMLElement;

        if (!handle) { return; }

        handle.addEventListener('mousedown', (e: MouseEvent) => {
            // Solo permitimos arrastrar con el botón izquierdo
            if (e.button !== 0) { return; }

            // Evitamos seleccionar texto por accidente al arrastrar
            e.preventDefault();

            const sourceKey = row.dataset.rowkey;
            if (!sourceKey) { return; }

            // Coordenadas iniciales
            const startY = e.clientY;
            const startRect = row.getBoundingClientRect();

            // Creamos un elemento fantasma visual que flotará siguiendo el ratón
            const ghost = row.cloneNode(true) as HTMLTableRowElement;
            ghost.style.position = 'fixed';
            ghost.style.left = `${startRect.left}px`;
            ghost.style.top = `${startRect.top}px`;
            ghost.style.width = `${startRect.width}px`;
            ghost.style.height = `${startRect.height}px`;
            ghost.style.opacity = '0.85';
            ghost.style.pointerEvents = 'none';
            ghost.style.zIndex = '1000';
            ghost.style.boxShadow = '0 8px 16px rgba(0,0,0,0.3)';
            ghost.style.backgroundColor = getComputedStyle(row).backgroundColor || 'var(--vscode-editor-background)';
            document.body.appendChild(ghost);

            // Marcamos la fila original como "en arrastre" (transparente)
            row.classList.add('dragging');

            let targetKey: string | null = null;
            let insertAfter = false;

            const onMouseMove = (moveEvent: MouseEvent) => {
                // RESTRICCIÓN HORIZONTAL: Mantenemos la X fija al punto de origen, solo movemos la Y
                const deltaY = moveEvent.clientY - startY;
                ghost.style.top = `${startRect.top + deltaY}px`;

                // Detectamos sobre qué fila estamos pasando verticalmente
                const elementBelow = document.elementFromPoint(startRect.left + 50, moveEvent.clientY);
                const targetTr = elementBelow?.closest('tr[data-rowkey]') as HTMLTableRowElement;

                // Limpiamos indicadores visuales anteriores
                app.querySelectorAll('tr').forEach(t => t.classList.remove('drag-over', 'drag-over-bottom'));

                if (targetTr && targetTr !== row) {
                    targetKey = targetTr.dataset.rowkey || null;
                    const rect = targetTr.getBoundingClientRect();
                    const relY = moveEvent.clientY - rect.top;

                    insertAfter = relY >= rect.height / 2;
                    if (insertAfter) {
                        targetTr.classList.add('drag-over-bottom');
                    } else {
                        targetTr.classList.add('drag-over');
                    }
                } else {
                    targetKey = null;
                }
            };

            const onMouseUp = () => {
                // Limpieza de eventos globales
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);

                // Eliminamos el fantasma y restauramos la fila
                ghost.remove();
                row.classList.remove('dragging');
                app.querySelectorAll('tr').forEach(t => t.classList.remove('drag-over', 'drag-over-bottom'));

                // Si hay un destino válido, disparamos el evento de movimiento a VS Code
                if (targetKey && sourceKey !== targetKey) {
                    vscode.postMessage({
                        type: 'MOVE_ENTRY',
                        sourceKey: sourceKey,
                        targetKey: targetKey,
                        insertAfter: insertAfter
                    });
                }
            };

            // Escuchamos el movimiento y el soltar a nivel global de ventana
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    });
}

window.addEventListener('message', (event: MessageEvent) => {
    switch (event.data.type) {
        case 'UPDATE_CONTENT':
            updateTable(event.data.entries);
            break;
        case 'ADDED':
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