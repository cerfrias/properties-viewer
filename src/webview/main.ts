import './style.css';
import hljs from 'highlight.js';
import 'highlight.js/styles/vs2015.css';

type WebviewMessage =
    | { type: 'UPDATE_ENTRY'; lineIdx: number; value: string }
    | { type: 'UPDATE_KEY'; lineIdx: number; newKey: string }
    | { type: 'ADD_ENTRY'; key: string; value: string }
    | { type: 'DELETE_LINE'; lineIdx: number }
    | { type: 'UPDATE_COMMENT'; lineIdx: number; value: string }
    | { type: 'ADD_COMMENT'; comment: string }
    | { type: 'MOVE_ENTRY'; sourceIdx: number; targetIdx: number; insertAfter: boolean };

declare function acquireVsCodeApi(): {
    postMessage(message: WebviewMessage): void;
};

const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;
const addBtn = document.getElementById('add-btn')!;
const addCommentBtn = document.getElementById('add-comment-btn')!;

addBtn.addEventListener('click', (e) => {
    // Ahora admite claves duplicadas
    vscode.postMessage({ type: 'ADD_ENTRY', key: "key", value: 'value' });
});

addCommentBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'ADD_COMMENT', comment: "# " });
});

type tmType = "KEY" | "VALUE" | "COMMENT";

interface timeoutMD {
    id: number;
    type: tmType;
    lineIdx: number;
    value: string;
}

// --- 1. TimeoutManager optimizado ---
class timeoutManager {
    private timeouts = new Map<string, timeoutMD>();

    private key(type: tmType, lineIdx: number): string {
        return `${type}:${lineIdx}`;
    }

    private set(type: tmType, tmId: number, lineIdx: number, value: string) {
        this.timeouts.set(this.key(type, lineIdx), { id: tmId, type, lineIdx, value });
    }

    public renameKey(lineIdx: number, newKey: string, immediate: boolean = false) {
        clearTimeout(this.timeouts.get(this.key("KEY", lineIdx))?.id);

        if (immediate) {
            vscode.postMessage({ type: 'UPDATE_KEY', lineIdx, newKey });
            return;
        }

        this.set("KEY",
            window.setTimeout(() => {
                vscode.postMessage({ type: 'UPDATE_KEY', lineIdx, newKey });
            }, 400),
            lineIdx,
            newKey
        );
    }

    public saveValue(lineIdx: number, value: string, immediate: boolean = false) {
        clearTimeout(this.timeouts.get(this.key("VALUE", lineIdx))?.id);

        if (immediate) {
            vscode.postMessage({ type: 'UPDATE_ENTRY', lineIdx, value });
            return;
        }

        this.set("VALUE",
            window.setTimeout(() => {
                vscode.postMessage({ type: 'UPDATE_ENTRY', lineIdx, value });
            }, 300),
            lineIdx,
            value
        );
    }

    public saveComment(lineIdx: number, value: string, immediate: boolean = false) {
        clearTimeout(this.timeouts.get(this.key("COMMENT", lineIdx))?.id);

        if (immediate) {
            vscode.postMessage({ type: 'UPDATE_COMMENT', lineIdx, value });
            return;
        }

        this.set("COMMENT",
            window.setTimeout(() => {
                vscode.postMessage({ type: 'UPDATE_COMMENT', lineIdx, value });
            }, 300),
            lineIdx,
            value
        );
    }
}

const TM = new timeoutManager();

// --- 2. renderTable y eventos del Input ajustados ---
function renderTable(entries: [number, string, string][]) {
    app.innerHTML = `
    <table>
      <thead>
        <tr><th></th><th>Key</th><th>Value</th><th></th></tr>
      </thead>
      <tbody>
        ${entries.map(([idx, k, v]) => {
        const displayValue = unescapeValue(v);
        let textToHighlight = displayValue;
        if (textToHighlight.endsWith('\n')) { textToHighlight += ' '; }

        const result = hljs.highlightAuto(textToHighlight);
        const highlightedText = result.value || escapeHtml(textToHighlight);

        return `
            <tr data-key="${escapeHtml(k)}" data-idx="${idx}">
              <!-- Manillar de arrastre común para toda la fila -->
              <td class="drag-handle" data-idx="${idx}">⠿</td>
            
              ${k === "#" ?
                `
                <!-- Comentario con colspan="2" para ocupar el ancho de Key y Value -->
                <td colspan="2" class="comment-cell">
                  <input class="comment-input" data-idx="${idx}" type="text" value="${escapeHtml(displayValue)}">
                </td>
                `
                :
                `
                <!-- Fila normal de Key / Value -->
                <td><input class="key-input" type="text" data-idx="${idx}" data-key="${escapeHtml(k)}" value="${escapeHtml(k)}"></td>
                <td>
                  <div class="editor-wrapper">
                    <textarea data-idx="${idx}" spellcheck="false" rows="1">${escapeHtml(displayValue)}</textarea>
                    <pre aria-hidden="true"><code class="hljs ${result.language || ''}">${highlightedText}</code></pre>
                  </div>
                </td>
                `
            }
                <td class="action-cell">
                  <button class="delete-btn" data-idx="${idx}" title="Delete Row">✕</button>
                </td>
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
            const idx = Number.parseInt(ta.dataset.idx!);
            if (!Number.isNaN(idx)) {
                TM.saveValue(idx, escapeValue(ta.value));
            }
        });

        ta.addEventListener('blur', () => {
            const idx = Number.parseInt(ta.dataset.idx!);
            if (!Number.isNaN(idx)) {
                TM.saveValue(idx, escapeValue(ta.value), true);
            }
        });
    });

    app.querySelectorAll('input.key-input').forEach((ti: Element) => {
        const inputEl = ti as HTMLInputElement;

        inputEl.addEventListener('keydown', (e: Event) => {
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

        inputEl.addEventListener('input', () => {
            const idx = Number.parseInt(inputEl.dataset.idx!);
            if (!Number.isNaN(idx)) {
                TM.renameKey(idx, inputEl.value);
            }
        });

        inputEl.addEventListener('blur', () => {
            const idx = Number.parseInt(inputEl.dataset.idx!);
            if (!Number.isNaN(idx)) {
                TM.renameKey(idx, inputEl.value, true);
            }
        });
    });

    app.querySelectorAll('input.comment-input').forEach((tie) => {
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
            const idx = Number.parseInt(ti.dataset.idx!);
            if (!Number.isNaN(idx)) {
                TM.saveComment(idx, escapeValue(ti.value));
            }
        });

        ti.addEventListener('blur', () => {
            const idx = Number.parseInt(ti.dataset.idx!);
            if (!Number.isNaN(idx)) {
                TM.saveComment(idx, escapeValue(ti.value), true);
            }
        });
    });

    app.querySelectorAll('.delete-btn').forEach((btn: Element) => {
        btn.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const lineIdx = Number.parseInt(target.dataset.idx!);
            vscode.postMessage({ type: 'DELETE_LINE', lineIdx });
        });
    });

    setupDragAndDrop();
}

// --- 3. updateTable protegiendo el foco ---
function updateTable(entries: [number, string, string][]) {
    const currentKeys = Array.from(
        app.querySelectorAll('tr[data-key]'))
        .map(tr => `${(tr as HTMLElement).dataset.idx}:${(tr as HTMLElement).dataset.key}`);

    const newKeys = entries.map(([idx, k]) => `${idx}:${k}`);

    const activeEl = document.activeElement;
    const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

    if (currentKeys.join(',') !== newKeys.join(',')) {
        if (isTyping && currentKeys.length === newKeys.length) {
            // Ignoramos la recreación del DOM para no robar foco mientras se escribe
        } else {
            renderTable(entries);
            return;
        }
    }

    entries.forEach(([idx, k, v]) => {
        const displayValue = unescapeValue(v);

        // Mantenemos sincronizado el data-key del <tr>
        const tr = app.querySelector(`tr[data-idx="${idx}"]`) as HTMLTableRowElement;
        if (tr) {
            tr.dataset.key = k;
        }

        // 1. Lógica para COMENTARIOS
        if (k === "#") {
            const commentInput = app.querySelector(`input.comment-input[data-idx="${idx}"]`) as HTMLInputElement;
            if (commentInput && commentInput.value !== displayValue) {
                // Protegemos el foco si el usuario está escribiendo justo en este comentario
                if (document.activeElement === commentInput) { return; }
                commentInput.value = displayValue;
            }
            return;
        }

        // 2. Lógica para VALORES (Textarea)
        const ta = app.querySelector(`textarea[data-idx="${idx}"]`) as HTMLTextAreaElement;
        if (ta && ta.value !== displayValue) {
            if (document.activeElement === ta) { return; }
            ta.value = displayValue;
            syncHighlight(ta);
        }

        // 3. Lógica para CLAVES (Input) - (Usado en el Undo general o cambios externos)
        const inputEl = app.querySelector(`input.key-input[data-idx="${idx}"]`) as HTMLInputElement;
        if (inputEl) {
            inputEl.dataset.key = k;
            if (inputEl.value !== k && document.activeElement !== inputEl) {
                inputEl.value = k;
            }
        }
    });
}

// Función independiente para manejar el Drag and Drop
function setupDragAndDrop() {
    app.querySelectorAll('tr[data-key]').forEach(tr => {
        const row = tr as HTMLTableRowElement;
        const handle = row.querySelector('.drag-handle') as HTMLElement;

        if (!handle) { return; }

        handle.addEventListener('mousedown', (e: MouseEvent) => {
            // Solo permitimos arrastrar con el botón izquierdo
            if (e.button !== 0) { return; }

            // Evitamos seleccionar texto por accidente al arrastrar
            e.preventDefault();

            const sourceIdx = Number.parseInt(row.dataset.idx!);

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

            let targetIdx: number | null = null;
            let insertAfter = false;

            const onMouseMove = (moveEvent: MouseEvent) => {
                // RESTRICCIÓN HORIZONTAL: Mantenemos la X fija al punto de origen, solo movemos la Y
                const deltaY = moveEvent.clientY - startY;
                ghost.style.top = `${startRect.top + deltaY}px`;

                // Detectamos sobre qué fila estamos pasando verticalmente
                const clampedX = Math.min(
                    Math.max(moveEvent.clientX, startRect.left + 1),
                    startRect.left + startRect.width - 1
                );
                const elementBelow = document.elementFromPoint(clampedX, moveEvent.clientY);
                const targetTr = elementBelow?.closest('tr[data-key]') as HTMLTableRowElement;

                // Limpiamos indicadores visuales anteriores
                app.querySelectorAll('tr').forEach(t => t.classList.remove('drag-over', 'drag-over-bottom'));

                if (targetTr && targetTr !== row) {
                    targetIdx = Number.parseInt(targetTr.dataset.idx!);
                    const rect = targetTr.getBoundingClientRect();
                    const relY = moveEvent.clientY - rect.top;

                    insertAfter = relY >= rect.height / 2;
                    if (insertAfter) {
                        targetTr.classList.add('drag-over-bottom');
                    } else {
                        targetTr.classList.add('drag-over');
                    }

                } else {
                    targetIdx = null;
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
                if (targetIdx !== null && sourceIdx !== targetIdx) {
                    vscode.postMessage({
                        type: 'MOVE_ENTRY',
                        sourceIdx: sourceIdx,
                        targetIdx: targetIdx,
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
    let out = '';
    for (let i = 0; i < val.length; i++) {
        if (val[i] === '\\' && i + 1 < val.length) {
            const next = val[i + 1];
            switch (next) {
                case 'n': out += '\n'; i++; break;
                case 't': out += '\t'; i++; break;
                case 'r': out += '\r'; i++; break;
                case '\\': out += '\\'; i++; break;
                case ':': out += ':'; i++; break;
                case '=': out += '='; i++; break;
                case ' ': out += ' '; i++; break;
                case 'u': {
                    const hex = val.slice(i + 2, i + 6);
                    if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                        out += String.fromCharCode(parseInt(hex, 16));
                        i += 5;
                    } else {
                        out += next;
                        i++;
                    }
                    break;
                }
                default:
                    out += next;
                    i++;
            }
        } else {
            out += val[i];
        }
    }
    return out;
}

function escapeValue(val: string): string {
    return val
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/:/g, '\\:')
        .replace(/=/g, '\\=');
}

function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
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