// Aetheria Unified Memory v5.5 — conservative titled TXT/Markdown adapter.
// Only H1/H2 headings split the file. Untitled text remains one entry so that
// an uncertain heuristic cannot silently shatter user-authored source material.

function cleanNulls(value) {
    return String(value ?? '').replace(/\u0000/g, '');
}

function filenameStem(filename) {
    const name = String(filename || 'Imported text').replace(/\\/g, '/').split('/').pop() || 'Imported text';
    return name.replace(/\.[^.]+$/, '').trim() || 'Imported text';
}

function headingMatches(text) {
    const lines = text.split('\n');
    const matches = [];
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^\s{0,3}(#{1,2})\s+(.+?)\s*#*\s*$/);
        if (match) {
            matches.push({
                line_index: i,
                start: offset,
                end: offset + line.length,
                level: match[1].length,
                title: match[2].trim(),
            });
        }
        offset += line.length + (i < lines.length - 1 ? 1 : 0);
    }
    return matches;
}

export function parseTitledText(rawText, { filename = null } = {}) {
    const text = cleanNulls(rawText).replace(/\r\n?/g, '\n');
    const headings = headingMatches(text);
    const entries = [];
    const warnings = [];

    if (!headings.length) {
        entries.push({
            source_entry_id: 'text:0',
            title: filenameStem(filename),
            comment: null,
            content: text.trim(),
            keys: [],
            secondary_keys: [],
            constant: false,
            disabled: false,
            order: 0,
            raw_extra: {},
            _source_ordinal: 0,
        });
        warnings.push('No H1/H2 headings detected; the file will be imported as one entry.');
        return {
            format: 'titled_txt',
            entries,
            warnings,
            metadata: {
                adapter: 'titled-text-v1',
                segmentation: 'whole_file',
                heading_count: 0,
                parsed_entry_count: 1,
            },
        };
    }

    const preamble = text.slice(0, headings[0].start).trim();
    let ordinal = 0;
    if (preamble) {
        entries.push({
            source_entry_id: `text:${ordinal}`,
            title: `${filenameStem(filename)}｜前言`,
            comment: null,
            content: preamble,
            keys: [],
            secondary_keys: [],
            constant: false,
            disabled: false,
            order: ordinal,
            raw_extra: { section_kind: 'preamble' },
            _source_ordinal: ordinal,
        });
        ordinal += 1;
        warnings.push('Text exists before the first heading; it is preserved as a separate preamble entry.');
    }

    for (let i = 0; i < headings.length; i++) {
        const heading = headings[i];
        const bodyStart = heading.end + (text[heading.end] === '\n' ? 1 : 0);
        const bodyEnd = i + 1 < headings.length ? headings[i + 1].start : text.length;
        const content = text.slice(bodyStart, bodyEnd).trim();
        entries.push({
            source_entry_id: `text:${ordinal}`,
            title: heading.title || `Section ${ordinal + 1}`,
            comment: null,
            content,
            keys: [],
            secondary_keys: [],
            constant: false,
            disabled: false,
            order: ordinal,
            raw_extra: { heading_level: heading.level },
            _source_ordinal: ordinal,
        });
        ordinal += 1;
    }

    return {
        format: 'titled_txt',
        entries,
        warnings,
        metadata: {
            adapter: 'titled-text-v1',
            segmentation: 'headings',
            heading_count: headings.length,
            parsed_entry_count: entries.length,
        },
    };
}
