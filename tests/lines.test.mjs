import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { deleteLines, cutLines, moveLines, duplicateLines } = await import(join(dirname(fileURLToPath(import.meta.url)), "../mods/code/lines.js"));

// What the editor does with an edit: replace text[from, to], then select start..end. `|` marks the cursor, `[` `]` a selection.
const parse = (marked) => {
  const open = marked.indexOf("[");
  if (open >= 0) {
    const close = marked.indexOf("]");
    return { text: marked.slice(0, open) + marked.slice(open + 1, close) + marked.slice(close + 1), start: open, end: close - 1 };
  }
  const at = marked.indexOf("|");
  return { text: marked.slice(0, at) + marked.slice(at + 1), start: at, end: at };
};
const show = (text, { start, end }) => (start === end ? `${text.slice(0, start)}|${text.slice(start)}` : `${text.slice(0, start)}[${text.slice(start, end)}]${text.slice(end)}`);
const run = (operation, marked) => {
  const { text, start, end } = parse(marked);
  const edit = operation(text, { start, end });
  if (!edit) return edit;
  const result = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
  return { shown: show(result, edit), edit };
};

test("delete: a line in the middle takes its newline, the cursor keeps its column on the line that comes up", () => {
  assert.equal(run(deleteLines, "one\ntw|o\nthree").shown, "one\nth|ree");
  assert.equal(run(deleteLines, "one\nt|wo\nsix").shown, "one\ns|ix");
  assert.equal(run(deleteLines, "one\ntwo|\nsix").shown, "one\nsix|");
});

test("delete: the first line, the last line and the only line", () => {
  assert.equal(run(deleteLines, "o|ne\ntwo").shown, "t|wo");
  assert.equal(run(deleteLines, "one\ntw|o").shown, "on|e");
  assert.equal(run(deleteLines, "one\nt|wo").shown, "o|ne");
  assert.equal(run(deleteLines, "ab|c").shown, "|");
  assert.equal(run(deleteLines, "|").shown, "|");
});

test("delete: a file that ends with a newline", () => {
  assert.equal(run(deleteLines, "one\n|").shown, "|one", "the column is 0, so the cursor goes to the start of the line above");
  assert.equal(run(deleteLines, "o|ne\n").shown, "|");
  assert.equal(run(deleteLines, "one\nt|wo\n").shown, "one\n|", "the line that comes up is the empty one after the final newline");
});

test("delete: every line the selection touches, and not the one it only reaches the start of", () => {
  assert.equal(run(deleteLines, "a\nb[c\nde]f\ng").shown, "a\ng|");
  assert.equal(run(deleteLines, "a\n[b\nc\n]d").shown, "a\n|d");
  assert.equal(run(deleteLines, "[a\nb]\nc").shown, "|c");
});

test("cut: a plain cursor cuts its line with the newline; a selection is left to the editor", () => {
  const cut = run(cutLines, "one\nt|wo\nsix");
  assert.equal(cut.shown, "one\ns|ix");
  assert.equal(cut.edit.copy, "two\n");
  assert.equal(run(cutLines, "one\ntwo|").edit.copy, "two\n");
  assert.equal(cutLines("one\ntwo", { start: 1, end: 3 }), false);
});

test("move up and down: the line swaps with its neighbour and the cursor goes with it", () => {
  assert.equal(run(moveLines(-1), "one\ntw|o\nthree").shown, "tw|o\none\nthree");
  assert.equal(run(moveLines(1), "on|e\ntwo\nthree").shown, "two\non|e\nthree");
  assert.equal(run(moveLines(1), "one\nt|wo\nthree").shown, "one\nthree\nt|wo");
  assert.equal(run(moveLines(-1), "one\ntwo\nth|ree").shown, "one\nth|ree\ntwo");
});

test("move: a selection of several lines moves as a block and stays selected", () => {
  assert.equal(run(moveLines(-1), "a\n[b\nc]\nd").shown, "[b\nc]\na\nd");
  assert.equal(run(moveLines(1), "a\n[b\nc]\nd").shown, "a\nd\n[b\nc]");
});

test("move: nothing to do past the first or last line", () => {
  assert.equal(run(moveLines(-1), "o|ne\ntwo"), null);
  assert.equal(run(moveLines(1), "one\ntw|o"), null);
  assert.equal(run(moveLines(1), "|"), null);
});

test("move: into the empty line a final newline leaves", () => {
  assert.equal(run(moveLines(1), "one\nt|wo\n").shown, "one\n\nt|wo");
});

test("duplicate: the copy goes under, with the cursor on it", () => {
  assert.equal(run(duplicateLines, "one\nt|wo\nsix").shown, "one\ntwo\nt|wo\nsix");
  assert.equal(run(duplicateLines, "one\ntw|o").shown, "one\ntwo\ntw|o");
  assert.equal(run(duplicateLines, "a\n[b\nc]\nd").shown, "a\nb\nc\n[b\nc]\nd");
});

test("the edit says which lines it touches, the neighbour of a move included", () => {
  const { text, start, end } = parse("a\nb|\nc\nd");
  const touches = (edit) => [edit.first, edit.last];
  assert.deepEqual(touches(deleteLines(text, { start, end })), [1, 1]);
  assert.deepEqual(touches(moveLines(-1)(text, { start, end })), [0, 1]);
  assert.deepEqual(touches(moveLines(1)(text, { start, end })), [1, 2]);
  assert.deepEqual(touches(duplicateLines(text, { start, end })), [1, 1]);
  const block = parse("a\n[b\nc]\nd");
  assert.deepEqual(touches(deleteLines(block.text, block)), [1, 2]);
});

test("offsets are UTF-16, like the editor's selection", () => {
  const { text, start, end } = parse("é\n😀 a|b\nz");
  assert.equal(run(deleteLines, "é\n😀 a|b\nz").shown, "é\nz|", "column 4 (UTF-16) is brought back to the end of the short line");
  assert.equal(moveLines(-1)(text, { start, end }).text, "😀 ab\né");
});
