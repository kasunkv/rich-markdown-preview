import type { WebviewCommand, DocumentationAction, HostMessage } from './messages';
import type { DocumentationFile } from './documentation';
import { documentInWorkspaceRoots, readingStateLimits } from './reading-state';

export interface DocumentationViewState {
  expanded?: string[];
  filter?: string;
  outline?: boolean;
}
interface Bridge {
  postMessage(message: WebviewCommand): void;
  getState(): { documentation?: DocumentationViewState } | undefined;
  setState(state: unknown): void;
}
type IndexMessage = Omit<Extract<HostMessage, { type: 'documentation' }>, 'type'>;
interface Folder {
  name: string;
  key: string;
  folders: Map<string, Folder>;
  files: DocumentationFile[];
  count: number;
}
const visibleBatch = 100;
const maxSavedFolders = 10;

export function documentationView(vscode: Bridge, content: HTMLElement) {
  let enabled = false;
  let data: IndexMessage = { files: [], loading: true, canBack: false, canForward: false };
  let homeRoots = new Map<string, Folder>();
  let homeSnapshot: number | undefined;
  const saved = vscode.getState()?.documentation;
  const expanded = new Set((saved?.expanded ?? []).slice(-maxSavedFolders));
  let filter = saved?.filter ?? '';
  let showOutline = saved?.outline ?? false;
  let previousActive: string | undefined;
  let sidebar: HTMLElement, tree: HTMLElement, search: HTMLInputElement, notice: HTMLElement;
  let back: HTMLButtonElement, forward: HTMLButtonElement, source: HTMLButtonElement, path: HTMLElement;
  let documentsButton: HTMLButtonElement, outlineButton: HTMLButtonElement;
  const send = (action: DocumentationAction, id?: string) =>
    vscode.postMessage({ type: 'documentationAction', action, id });
  const save = () => {
    while (expanded.size > Math.min(readingStateLimits.expandedDirectories, maxSavedFolders))
      expanded.delete(expanded.values().next().value!);
    vscode.setState({ ...vscode.getState(), documentation: { expanded: [...expanded], filter, outline: showOutline } });
  };
  const button = (label: string, action: () => void) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.addEventListener('click', action);
    return node;
  };
  const selectTab = (outline: boolean) => {
    showOutline = outline;
    document.body.classList.toggle('documentation-outline', outline);
    documentsButton.setAttribute('aria-pressed', String(!outline));
    outlineButton.setAttribute('aria-pressed', String(outline));
    save();
  };
  function setup() {
    if (enabled) return;
    enabled = true;
    document.body.classList.add('documentation-mode');
    const bar = document.createElement('div');
    bar.className = 'documentation-bar';
    bar.setAttribute('aria-label', 'Documentation navigation');
    back = button('← Back', () => send('back'));
    forward = button('Forward →', () => send('forward'));
    source = button('Open source', () => send('source'));
    path = document.createElement('span');
    path.className = 'documentation-path';
    bar.append(
      button('Home', () => send('home')),
      back,
      forward,
      path,
      source,
      button('Refresh', () => send('refresh')),
    );
    document.querySelector('.toolbar')!.after(bar);
    sidebar = document.createElement('aside');
    sidebar.className = 'documentation-sidebar';
    sidebar.setAttribute('aria-label', 'Documentation');
    const tabs = document.createElement('div');
    tabs.className = 'documentation-tabs';
    documentsButton = button('Documents', () => selectTab(false));
    outlineButton = button('On this page', () => selectTab(true));
    tabs.append(documentsButton, outlineButton);
    const documents = document.createElement('div');
    documents.className = 'documentation-documents';
    search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Filter documentation files or folders…';
    search.setAttribute('aria-label', 'Filter documentation files or folders');
    search.value = filter;
    search.addEventListener('input', () => {
      filter = search.value.slice(0, readingStateLimits.filterLength);
      search.value = filter;
      save();
      renderTree();
    });
    notice = document.createElement('p');
    notice.className = 'documentation-notice';
    notice.setAttribute('role', 'status');
    tree = document.createElement('nav');
    tree.setAttribute('aria-label', 'Documentation files');
    documents.append(search, notice, tree);
    const outline = document.querySelector<HTMLElement>('.outline')!;
    sidebar.append(tabs, documents, outline);
    document.querySelector('.layout')!.prepend(sidebar);
    document.getElementById('rmp-ui-toggle-outline')!.textContent = 'Navigation';
    selectTab(showOutline);
    const resize = () =>
      document.documentElement.style.setProperty(
        '--documentation-top',
        `${document.querySelector('.toolbar')!.getBoundingClientRect().height + 12}px`,
      );
    new ResizeObserver(resize).observe(document.querySelector('.toolbar')!);
    resize();
  }
  function buildTree(files: DocumentationFile[]) {
    const roots = new Map<string, Folder>();
    for (const file of files) {
      let root = roots.get(file.root);
      if (!root) {
        root = { name: file.rootName, key: file.root, folders: new Map(), files: [], count: 0 };
        roots.set(file.root, root);
      }
      const parts = file.path.split('/');
      parts.pop();
      let folder = root;
      folder.count++;
      for (const part of parts) {
        const key = `${folder.key}/${part}`;
        if (!folder.folders.has(part))
          folder.folders.set(part, { name: part, key, folders: new Map(), files: [], count: 0 });
        folder = folder.folders.get(part)!;
        folder.count++;
      }
      folder.files.push(file);
    }
    return roots;
  }
  function renderTree() {
    const activeElement = document.activeElement as HTMLElement | null;
    const focused = activeElement && tree.contains(activeElement) ? activeElement.dataset.key : undefined;
    const scroll = sidebar.scrollTop;
    const query = filter.trim().toLocaleLowerCase();
    const files = data.files.filter((file) => `${file.rootName}/${file.path}`.toLocaleLowerCase().includes(query));
    const activeFolders = new Set<string>();
    const active = files.find((file) => file.id === data.active);
    if (active) {
      let key = active.root;
      activeFolders.add(key);
      for (const part of active.path.split('/').slice(0, -1)) {
        key += `/${part}`;
        activeFolders.add(key);
      }
    }
    tree.replaceChildren();
    notice.textContent =
      data.error ??
      (data.loading
        ? 'Finding Markdown files…'
        : `${files.length} of ${data.files.length} indexed documents${data.truncated ? ' — result limit reached; refine the include setting to find other documents' : data.complete === false ? ' — some provider documents are unavailable; check workspace trust and access' : ''}`);
    const renderFolder = (folder: Folder, parent: HTMLElement, root = false) => {
      const details = document.createElement('details');
      details.className = 'documentation-folder';
      details.open =
        activeFolders.has(folder.key) ||
        (root && (!!query || !expanded.has(`closed:${folder.key}`))) ||
        (!root && (expanded.has(folder.key) || (!!query && files.length <= visibleBatch)));
      const summary = document.createElement('summary');
      summary.textContent = folder.name;
      summary.dataset.key = folder.key;
      summary.title = folder.name;
      details.append(summary);
      details.addEventListener('toggle', () => {
        if (query || !details.isConnected) return;
        if (details.open) {
          expanded.add(folder.key);
          expanded.delete(`closed:${folder.key}`);
        } else {
          expanded.delete(folder.key);
          expanded.add(`closed:${folder.key}`);
        }
        save();
      });
      const children = document.createElement('div');
      children.className = 'documentation-children';
      details.append(children);
      let shown = 0;
      let populated = false;
      const folders = [...folder.folders.values()].sort(
        (a, b) =>
          Number(activeFolders.has(b.key)) - Number(activeFolders.has(a.key)) ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
      const selected = folder.files.find((file) => file.id === data.active);
      const entries: (Folder | DocumentationFile)[] = selected
        ? [selected, ...folders, ...folder.files.filter((file) => file !== selected)]
        : [...folders, ...folder.files];
      const total = entries.length;
      const appendBatch = () => {
        const pagingButtonFocused = document.activeElement === more;
        const end = Math.min(shown + visibleBatch, total);
        for (; shown < end; shown++) {
          const entry = entries[shown];
          if ('folders' in entry) {
            renderFolder(entry, children);
          } else {
            const file = entry;
            const link = button(file.path.split('/').pop()!, () => send('open', file.id));
            link.className = 'documentation-file';
            link.dataset.key = file.id;
            link.title = file.path;
            if (file.id === data.active) link.setAttribute('aria-current', 'page');
            children.append(link);
          }
        }
        more?.remove();
        if (shown < total) {
          more = button(`Show more (${total - shown} remaining)`, appendBatch);
          more.className = 'documentation-more';
          children.append(more);
        }
        if (pagingButtonFocused) (more?.isConnected ? more : (children.lastElementChild as HTMLElement))?.focus();
      };
      let more: HTMLButtonElement | undefined;
      const populate = () => {
        if (populated) return;
        populated = true;
        appendBatch();
      };
      if (details.open) populate();
      details.addEventListener('toggle', () => {
        if (details.open) populate();
      });
      parent.append(details);
    };
    for (const root of (query ? buildTree(files) : homeRoots).values()) renderFolder(root, tree, true);
    if (!files.length && !data.loading) {
      const empty = document.createElement('p');
      empty.textContent = query
        ? 'No matching documents.'
        : 'No Markdown files found. Check the documentation include/exclude settings, then refresh.';
      tree.append(empty);
    }
    if (focused)
      [...tree.querySelectorAll<HTMLElement>('[data-key]')]
        .find((node) => node.dataset.key === focused)
        ?.focus({ preventScroll: true });
    sidebar.scrollTop = scroll;
  }
  function renderHome() {
    if (data.active) return;
    content.replaceChildren();
    const title = document.createElement('h1');
    title.textContent = 'Documentation Home';
    const intro = document.createElement('p');
    intro.textContent =
      'Explore the Markdown documentation in your workspace. Choose a file from the navigation or browse a folder below.';
    content.append(title, intro);
    if (!data.files.length) {
      const empty = document.createElement('p');
      empty.textContent =
        data.error ??
        (data.loading
          ? 'Finding Markdown files…'
          : 'No Markdown files found. Open a workspace with Markdown documents or adjust the documentation include/exclude settings.');
      content.append(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'documentation-cards';
    for (const root of homeRoots.values()) {
      const group = document.createElement('section');
      const heading = document.createElement('h2');
      heading.textContent = root.name;
      group.append(heading);
      const readme = root.files.find((file) => /^readme\.(md|markdown)$/i.test(file.path));
      if (readme) group.append(button('Read README', () => send('open', readme.id)));
      for (const file of root.files.filter((file) => file !== readme).slice(0, visibleBatch))
        group.append(button(file.path, () => send('open', file.id)));
      if (root.files.length > visibleBatch) {
        const hint = document.createElement('p');
        hint.textContent = `Showing the first ${visibleBatch} root documents. Use the navigation to browse more.`;
        group.append(hint);
      }
      for (const folder of [...root.folders.values()].slice(0, visibleBatch)) {
        const count = folder.count;
        group.append(
          button(`${folder.name}/ · ${count} document${count === 1 ? '' : 's'}`, () => {
            filter = `${root.name}/${folder.name}/`.slice(0, readingStateLimits.filterLength);
            search.value = filter;
            selectTab(false);
            save();
            renderTree();
            search.focus();
          }),
        );
      }
      if (root.folders.size > visibleBatch) {
        const hint = document.createElement('p');
        hint.textContent = `Showing the first ${visibleBatch} folders. Use the navigation to browse more.`;
        group.append(hint);
      }
      grid.append(group);
    }
    content.append(grid);
  }
  return {
    enable: setup,
    receive(message: IndexMessage) {
      setup();
      data = message;
      if (!data.loading && !data.error) {
        const directories = new Set<string>();
        if (!data.truncated && data.complete !== false) {
          for (const file of data.files) {
            let key = file.root;
            directories.add(key);
            for (const part of file.path.split('/').slice(0, -1)) {
              key += `/${part}`;
              directories.add(key);
            }
          }
        }
        let pruned = false;
        for (const key of expanded) {
          const id = key.replace(/^closed:/, '');
          if (data.truncated || data.complete === false) {
            if (!data.roots || documentInWorkspaceRoots(id, data.roots)) continue;
          } else if (directories.has(id)) continue;
          expanded.delete(key);
          pruned = true;
        }
        if (pruned) save();
      }
      if (message.snapshot === undefined || homeSnapshot !== message.snapshot) {
        homeRoots = buildTree(data.files);
        homeSnapshot = message.snapshot;
      }
      back.disabled = !data.canBack;
      forward.disabled = !data.canForward;
      source.disabled = !data.active;
      const active = data.files.find((file) => file.id === data.active);
      path.textContent = active
        ? `${active.rootName} / ${active.path}`
        : data.active
          ? 'Document'
          : 'Documentation Home';
      path.title = path.textContent;
      if (active && data.active !== previousActive) {
        let key = active.root;
        expanded.add(key);
        expanded.delete(`closed:${key}`);
        for (const part of active.path.split('/').slice(0, -1)) {
          key += `/${part}`;
          expanded.add(key);
          expanded.delete(`closed:${key}`);
        }
        save();
      }
      previousActive = data.active;
      renderTree();
      renderHome();
    },
  };
}
