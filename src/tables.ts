export interface TablePreferences {
  query: string;
  column: number;
  direction: 'none' | 'ascending' | 'descending';
  density: 'comfortable' | 'compact';
}
export type TableState = Record<string, TablePreferences>;
export interface TableAction { type: 'tableCopy' | 'tableExport'; text: string; filename: string }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function numeric(value: string): number | undefined {
  const text = value.trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return undefined;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : undefined;
}
export function sortTableRows(rows: string[][], column: number, direction: TablePreferences['direction']): number[] {
  const order = rows.map((_, index) => index);
  if (direction === 'none') return order;
  return order.sort((a, b) => {
    const left = (rows[a][column] ?? '').trim(), right = (rows[b][column] ?? '').trim();
    // Missing values stay last in both directions; ties retain document order.
    if (!left || !right) return left ? -1 : right ? 1 : a - b;
    const ln = numeric(left), rn = numeric(right);
    const comparison = ln !== undefined && rn !== undefined ? ln - rn : collator.compare(left, right);
    return (direction === 'descending' ? -comparison : comparison) || a - b;
  });
}
export function tableCSV(rows: string[][]): string {
  return rows.map(row => row.map(value => {
    // Keep spreadsheet applications from interpreting text as a formula.
    const safe = /^[\s]*[=+\-@]/.test(value) && numeric(value) === undefined ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}

export function enhanceTables(root: HTMLElement, saved: TableState, send: (action: TableAction) => void, changed: (state: TableState) => void): TableState {
  const state: TableState = {};
  root.querySelectorAll<HTMLElement>('.table-scroll').forEach((scroll, index) => {
    const table = scroll.querySelector('table')!;
    const body = table.tBodies[0];
    if (!body || !table.tHead) return;
    const headers = Array.from(table.tHead.rows[0].cells);
    const labels = headers.map(cell => cell.textContent?.trim() ?? '');
    const rows = Array.from(body.rows);
    const values = rows.map(row => Array.from(row.cells, cell => cell.textContent?.trim() ?? ''));
    const key = JSON.stringify([index, labels]);
    const previous = saved[key];
    const settings: TablePreferences = {
      query: typeof previous?.query === 'string' ? previous.query : '',
      column: Number.isInteger(previous?.column) && previous.column >= 0 && previous.column < headers.length ? previous.column : 0,
      direction: ['ascending', 'descending'].includes(previous?.direction) ? previous.direction : 'none',
      density: previous?.density === 'compact' ? 'compact' : 'comfortable'
    };
    state[key] = settings;
    const panel = document.createElement('section'); panel.className = 'table-panel'; panel.setAttribute('aria-label', `Table ${index + 1} controls and data`);
    scroll.before(panel); panel.append(scroll);
    const toolbar = document.createElement('div'); toolbar.className = 'table-toolbar';
    toolbar.innerHTML = `<label class="table-search-label">Search<input type="search" class="table-search" placeholder="Filter rows…" aria-label="Search table ${index + 1}"></label><label>Spacing<select class="table-density" aria-label="Table ${index + 1} spacing"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><button type="button" class="table-reset" title="Clear search and restore original row order">Reset</button><span class="table-count" role="status" aria-live="polite"></span><button type="button" class="table-copy" title="Copy displayed rows as CSV">Copy CSV</button><button type="button" class="table-export" title="Save displayed rows as a CSV file">Export CSV</button>`;
    panel.prepend(toolbar);
    const search = toolbar.querySelector<HTMLInputElement>('.table-search')!;
    const density = toolbar.querySelector<HTMLSelectElement>('.table-density')!;
    const count = toolbar.querySelector<HTMLElement>('.table-count')!;
    const empty = document.createElement('p'); empty.className = 'table-empty'; empty.textContent = 'No matching rows. Clear the search to show all rows.'; empty.hidden = true; panel.append(empty);
    search.value = settings.query; density.value = settings.density;
    const buttons = headers.map((header, column) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'table-sort';
      const label = document.createElement('span'); while (header.firstChild) label.append(header.firstChild);
      const arrow = document.createElement('span'); arrow.className = 'table-sort-arrow'; arrow.setAttribute('aria-hidden', 'true');
      if (label.querySelector('a')) {
        // Keep links operable rather than nesting an anchor inside a button.
        const group = document.createElement('span'); group.className = 'table-header-linked';
        button.append(arrow); group.append(label, button); header.append(group);
      } else { button.append(label, arrow); header.append(button); }
      button.addEventListener('click', () => {
        settings.direction = settings.column !== column || settings.direction === 'none' ? 'ascending' : settings.direction === 'ascending' ? 'descending' : 'none';
        settings.column = column; apply(); changed(state);
      });
      return button;
    });
    let displayed: number[] = [];
    function apply() {
      const query = settings.query.trim().toLocaleLowerCase();
      const order = sortTableRows(values, settings.column, settings.direction);
      displayed = order.filter(row => values[row].some(cell => cell.toLocaleLowerCase().includes(query)));
      const visible = new Set(displayed);
      let stripe = 0;
      for (const row of order) {
        rows[row].hidden = !visible.has(row);
        rows[row].dataset.stripe = visible.has(row) ? (++stripe % 2 ? 'odd' : 'even') : '';
      }
      body.replaceChildren(...order.map(row => rows[row]));
      headers.forEach((header, column) => {
        const direction = settings.column === column ? settings.direction : 'none';
        if (direction === 'none') header.removeAttribute('aria-sort');
        else header.setAttribute('aria-sort', direction);
        buttons[column].querySelector('.table-sort-arrow')!.textContent = direction === 'ascending' ? '↑' : direction === 'descending' ? '↓' : '↕';
        buttons[column].setAttribute('aria-label', `${labels[column] || `Column ${column + 1}`}: ${direction === 'ascending' ? 'sort descending' : direction === 'descending' ? 'restore original order' : 'sort ascending'}`);
      });
      panel.dataset.density = settings.density;
      count.textContent = `${displayed.length} of ${rows.length} rows`;
      empty.hidden = displayed.length !== 0;
      toolbar.querySelector<HTMLButtonElement>('.table-reset')!.disabled = !settings.query && settings.direction === 'none';
    }
    search.addEventListener('input', () => { settings.query = search.value; apply(); changed(state); });
    density.addEventListener('change', () => { settings.density = density.value === 'compact' ? 'compact' : 'comfortable'; apply(); changed(state); });
    toolbar.querySelector('.table-reset')!.addEventListener('click', () => { settings.query = ''; settings.direction = 'none'; search.value = ''; apply(); changed(state); });
    const action = (type: TableAction['type']) => send({ type, text: tableCSV([labels, ...displayed.map(row => values[row])]), filename: `table-${index + 1}.csv` });
    toolbar.querySelector('.table-copy')!.addEventListener('click', () => action('tableCopy'));
    toolbar.querySelector('.table-export')!.addEventListener('click', () => action('tableExport'));
    apply();
  });
  return state;
}
