export type MarkdownEdit = {
    value: string;
    cursor: number;
};

export type NormalizedMarkdownEdit = {
    value: string;
    selectionStart: number;
    selectionEnd: number;
};

type OrderedListCounter = {
    indentLength: number;
    delimiter: string;
    nextNumber: number;
};

type Replacement = {
    start: number;
    end: number;
    text: string;
};

export function normalizeMarkdownOrderedLists(value: string, selectionStart: number, selectionEnd: number): NormalizedMarkdownEdit {
    const counters = new Map<string, OrderedListCounter>();
    const replacements: Replacement[] = [];
    let offset = 0;

    for (const line of value.split("\n")) {
        const ordered = line.match(/^(\s*)(\d+)([.)])(\s+)/);
        if (ordered) {
            const indentLength = ordered[1].length;
            const delimiter = ordered[3];
            for (const [key, counter] of counters) {
                if (counter.indentLength > indentLength || (counter.indentLength === indentLength && counter.delimiter !== delimiter)) {
                    counters.delete(key);
                }
            }

            const key = `${indentLength}:${delimiter}`;
            const currentNumber = Number(ordered[2]);
            const expectedNumber = counters.get(key)?.nextNumber ?? currentNumber;
            const expectedText = String(expectedNumber);
            if (ordered[2] !== expectedText) {
                const start = offset + indentLength;
                replacements.push({ start, end: start + ordered[2].length, text: expectedText });
            }
            counters.set(key, { indentLength, delimiter, nextNumber: expectedNumber + 1 });
        } else if (!line.trim()) {
            counters.clear();
        } else {
            const indentLength = line.match(/^\s*/)?.[0].length ?? 0;
            for (const [key, counter] of counters) {
                if (counter.indentLength >= indentLength) counters.delete(key);
            }
        }
        offset += line.length + 1;
    }

    if (replacements.length === 0) return { value, selectionStart, selectionEnd };

    let normalized = value;
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
        const replacement = replacements[index];
        normalized = normalized.slice(0, replacement.start) + replacement.text + normalized.slice(replacement.end);
    }
    return {
        value: normalized,
        selectionStart: adjustSelection(selectionStart, replacements),
        selectionEnd: adjustSelection(selectionEnd, replacements),
    };
}

export function continueMarkdownList(value: string, selectionStart: number, selectionEnd: number): MarkdownEdit | null {
    if (selectionStart !== selectionEnd) return null;

    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const lineEndIndex = value.indexOf("\n", selectionStart);
    const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
    const line = value.slice(lineStart, lineEnd);
    const marker = line.match(/^(\s*)(?:(\d+)([.)])|([-+*]))(\s+)(?:\[([ xX])\](\s+))?/);
    if (!marker) return null;

    const content = line.slice(marker[0].length);
    if (!content.trim()) {
        const nextValue = value.slice(0, lineStart) + value.slice(lineStart + marker[0].length);
        return { value: nextValue, cursor: lineStart };
    }

    const indent = marker[1];
    const listMarker = marker[2]
        ? `${Number(marker[2]) + 1}${marker[3]}`
        : marker[4];
    const checkbox = marker[6] === undefined ? "" : `[ ]${marker[7]}`;
    const nextPrefix = `${indent}${listMarker}${marker[5]}${checkbox}`;
    const insertedValue = `${value.slice(0, selectionStart)}\n${nextPrefix}${value.slice(selectionEnd)}`;
    const cursor = selectionStart + 1 + nextPrefix.length;
    const nextValue = marker[2]
        ? renumberFollowingOrderedItems(insertedValue, cursor, indent, marker[3], Number(marker[2]) + 2)
        : insertedValue;
    return { value: nextValue, cursor };
}

function renumberFollowingOrderedItems(value: string, insertedContentStart: number, indent: string, delimiter: string, nextNumber: number): string {
    const insertedLineEnd = value.indexOf("\n", insertedContentStart);
    if (insertedLineEnd === -1) return value;

    let result = value;
    let lineStart = insertedLineEnd + 1;
    while (lineStart < result.length) {
        const lineEndIndex = result.indexOf("\n", lineStart);
        const lineEnd = lineEndIndex === -1 ? result.length : lineEndIndex;
        const line = result.slice(lineStart, lineEnd);
        const ordered = line.match(/^(\s*)(\d+)([.)])(\s+)/);

        if (ordered && ordered[1] === indent && ordered[3] === delimiter) {
            const replacement = String(nextNumber);
            const numberStart = lineStart + indent.length;
            result = result.slice(0, numberStart) + replacement + result.slice(numberStart + ordered[2].length);
            const lengthChange = replacement.length - ordered[2].length;
            nextNumber += 1;
            lineStart = (lineEndIndex === -1 ? result.length : lineEnd + lengthChange + 1);
            continue;
        }

        if (!line.trim()) break;
        const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
        if (leadingWhitespace.length <= indent.length) break;
        lineStart = lineEndIndex === -1 ? result.length : lineEnd + 1;
    }
    return result;
}

function adjustSelection(position: number, replacements: Replacement[]): number {
    let adjusted = position;
    for (const replacement of replacements) {
        if (position <= replacement.start) continue;
        if (position >= replacement.end) {
            adjusted += replacement.text.length - (replacement.end - replacement.start);
        } else {
            adjusted += Math.min(position - replacement.start, replacement.text.length) - (position - replacement.start);
        }
    }
    return adjusted;
}
