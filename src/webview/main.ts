import './style.css';

// Interfaz para el objeto acquireVsCodeApi
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const app = document.getElementById('app')!;

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'UPDATE_CONTENT') {
    renderTable(message.entries);
  }
});

function renderTable(entries: Record<string, string>) {
  app.innerHTML = `
    <table>
      <thead>
        <tr><th>Key</th><th>Value</th></tr>
      </thead>
      <tbody>
        ${Object.entries(entries).map(([k, v]) => `
          <tr>
            <td>${k}</td>
            <td><input data-key="${k}" value="${v}" /></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  app.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      vscode.postMessage({
        type: 'UPDATE_ENTRY',
        key: target.getAttribute('data-key'),
        value: target.value
      });
    });
  });
}