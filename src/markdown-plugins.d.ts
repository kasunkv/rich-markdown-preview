declare module 'markdown-it-emoji' { export const full: import('markdown-it').PluginWithOptions<{ shortcuts?: Record<string, string[]> }>; }
declare module 'markdown-it-task-lists' { const plugin: import('markdown-it').PluginWithOptions<{ enabled?: boolean; label?: boolean }>; export default plugin; }
declare module 'markdown-it-footnote' { const plugin: import('markdown-it').PluginSimple; export default plugin; }
declare module 'markdown-it-deflist' { const plugin: import('markdown-it').PluginSimple; export default plugin; }
declare module 'markdown-it-mark' { const plugin: import('markdown-it').PluginSimple; export default plugin; }
declare module 'markdown-it-sub' { const plugin: import('markdown-it').PluginSimple; export default plugin; }
declare module 'markdown-it-sup' { const plugin: import('markdown-it').PluginSimple; export default plugin; }
