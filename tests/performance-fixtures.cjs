// Generated at runtime: no checked-in megabyte fixtures or user workspace access.
function fixtures() {
  return [1000,10000,50000].flatMap(rows => [
    {name:`table-${rows}`, rows, source:'| Item | Value |\n| --- | --- |\n'+Array.from({length:rows},(_,i)=>`| Row ${i} | ${i} |`).join('\n')},
    {name:`code-${rows}`, rows, source:'```typescript\n'+Array.from({length:rows},(_,i)=>`const value${i}: number = ${i};`).join('\n')+'\n```'},
    {name:`diagrams-${rows}`, rows, source:Array.from({length:rows},()=> '```mermaid\ngraph TD; A-->B\n```').join('\n\n')},
    {name:`invalid-diagrams-${rows}`, rows, source:Array.from({length:rows},()=> '```mermaid\nthis is not a diagram <<\n```').join('\n\n')},
  ]);
}
module.exports = {fixtures};
