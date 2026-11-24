// Line edits on the editor's text. Offsets are UTF-16, as the editor's selection is. Each operation takes the text and the selection
// ({ start, end }) and answers with the edit to make: replace text[from, to] with `text`, then select start..end. `first` and `last` are
// the lines (0-based) the edit touches, and `copy` the text a cut puts on the clipboard.
// It answers null when there is nothing to do (the first line moved up), and false when the key is not its to take (a cut with a selection).

const startOf = (text, at) => text.lastIndexOf("\n", at - 1) + 1;
const endOf = (text, at) => {
  const newline = text.indexOf("\n", at);
  return newline < 0 ? text.length : newline;
};
const lineOf = (text, at) => {
  let line = 0;
  for (let newline = text.indexOf("\n"); newline >= 0 && newline < at; newline = text.indexOf("\n", newline + 1)) line++;
  return line;
};

// The whole lines the selection covers; one that ends at the start of a line leaves that line out.
const span = (text, { start, end }) => {
  const from = startOf(text, start);
  const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
  return { from, to: endOf(text, last), first: lineOf(text, from), last: lineOf(text, last) };
};

export function deleteLines(text, selection) {
  const { from, to, first, last } = span(text, selection);
  const column = selection.start - from;
  if (to < text.length) {
    const next = endOf(text, to + 1) - (to + 1);
    const at = from + Math.min(column, next);
    return { from, to: to + 1, text: "", start: at, end: at, first, last };
  }
  if (from === 0) return { from: 0, to, text: "", start: 0, end: 0, first, last };
  const newline = from - 1;
  const previous = startOf(text, newline);
  const at = previous + Math.min(column, newline - previous);
  return { from: newline, to, text: "", start: at, end: at, first, last };
}

export function cutLines(text, selection) {
  if (selection.start !== selection.end) return false;
  const { from, to } = span(text, selection);
  return { ...deleteLines(text, selection), copy: `${text.slice(from, to)}\n` };
}

export const moveLines = (step) => (text, selection) => {
  const { from, to, first, last } = span(text, selection);
  if (step < 0) {
    if (from === 0) return null;
    const above = startOf(text, from - 1);
    const shift = from - above;
    return { from: above, to, text: `${text.slice(from, to)}\n${text.slice(above, from - 1)}`, start: selection.start - shift, end: selection.end - shift, first: first - 1, last };
  }
  if (to >= text.length) return null;
  const below = endOf(text, to + 1);
  const shift = below - to;
  return { from, to: below, text: `${text.slice(to + 1, below)}\n${text.slice(from, to)}`, start: selection.start + shift, end: selection.end + shift, first, last: last + 1 };
};

export function duplicateLines(text, selection) {
  const { from, to, first, last } = span(text, selection);
  const copy = text.slice(from, to);
  const shift = copy.length + 1;
  return { from: to, to, text: `\n${copy}`, start: selection.start + shift, end: selection.end + shift, first, last };
}
