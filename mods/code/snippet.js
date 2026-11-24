// The editor inserts a completion's text as it is, so a snippet ("build: ${1:path}$0") would land with its tab stops
// in it. This turns it into the text it stands for: a placeholder keeps its text, a choice its first value, a bare
// tab stop goes. The lines after the first take the indentation of the line the completion lands on, and the tabs that
// indent them become `unit` (the language's own indentation).
export function plainSnippet(snippet, indent = "", unit = "\t") {
  let text = snippet;
  for (let before; before !== text;) {
    before = text;
    text = text
      .replace(/(?<!\\)\$\{\d+:([^${}]*)\}/g, "$1")
      .replace(/(?<!\\)\$\{\d+\|([^,|}]*)[^|}]*\|\}/g, "$1");
  }
  return text
    .replace(/(?<!\\)(?:\$\{\d+\}|\$\d+)/g, "")
    .replace(/\\([$}\\])/g, "$1")
    .split("\n")
    .map((line, number) => (number && line ? indent + line.replace(/^\t+/, (tabs) => unit.repeat(tabs.length)) : line))
    .join("\n");
}

// A completion item with its snippet written out; any other item is returned as it is.
export function plainCompletion(item, indent, unit) {
  if (item?.insertTextFormat !== 2) return item;
  const plain = { ...item, insertTextFormat: 1 };
  if (typeof item.insertText === "string") plain.insertText = plainSnippet(item.insertText, indent, unit);
  if (typeof item.textEdit?.newText === "string") plain.textEdit = { ...item.textEdit, newText: plainSnippet(item.textEdit.newText, indent, unit) };
  return plain;
}
