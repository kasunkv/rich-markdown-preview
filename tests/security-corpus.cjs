const attackCorpus = [
  ['raw HTML', '<script>attack()</script>\n<img src="https://blocked.test/raw" onerror="attack()">\n<iframe src="https://blocked.test/frame"></iframe>'],
  ['frontmatter aliases', '---\nx: &x "<img src=https://blocked.test/yaml onerror=attack()>"\ny: [*x, *x]\ncycle: &cycle [*cycle]\n---\n# Safe'],
  ['executable links', '[execute](javascript:attack())\n[encoded](jav&#x61;script:attack())\n[script data](data:text/html;base64,PHNjcmlwdD5hdHRhY2soKTwvc2NyaXB0Pg==)'],
  ['remote images', '![unexpected](https://blocked.test/image.png)\n![protocol relative](//blocked.test/relative.png)'],
  ['Mermaid label', '```mermaid\nflowchart TD\nA["<img src=https://blocked.test/diagram onerror=attack()>"] --> B[Safe]\n```'],
  ['Mermaid directive', '```mermaid\n%%{init: {"securityLevel":"loose", "startOnLoad":true}}%%\nflowchart TD\nA[Safe] --> B[Safe]\nclick A "javascript:attack()"\n```'],
  ['Mermaid frontmatter config', '```mermaid\n---\nconfig:\n  securityLevel: loose\n---\nflowchart TD\nA[Safe] --> B[Safe]\nclick A "https://blocked.test/click"\n```'],
];
module.exports = { attackCorpus };
