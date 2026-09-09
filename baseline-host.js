// Aetheria Unified Memory v5.4 — conservative SillyTavern baseline source collector.
// Uses only functions/fields exposed through SillyTavern.getContext().

function text(value) {
    return String(value ?? '').replace(/\u0000/g, '').trim();
}

function addSource(out, source_type, source_id, title, value) {
    const body = text(value);
    if (!body) return;
    const id = text(source_id || title || source_type) || source_type;
    const key = `${source_type}|${id}|${body}`;
    if (out.__seen.has(key)) return;
    out.__seen.add(key);
    out.push({ source_type, source_id: id, title: text(title || id), text: body });
}

function characterData(character) {
    if (!character || typeof character !== 'object') return {};
    return character.data && typeof character.data === 'object' ? character.data : character;
}

function getCharacterName(character) {
    const data = characterData(character);
    return text(data.name || character?.name || data.char_name || character?.char_name || data.avatar || character?.avatar || 'character');
}

function collectCharacterText(out, character, label = 'character') {
    if (!character || typeof character !== 'object') return [];
    const data = characterData(character);
    const name = getCharacterName(character);
    const id = text(data.avatar || character.avatar || name || label);
    addSource(out, 'character_description', `${id}:description`, `${name}｜角色描述`, data.description ?? character.description);
    addSource(out, 'character_personality', `${id}:personality`, `${name}｜性格`, data.personality ?? character.personality);
    addSource(out, 'character_scenario', `${id}:scenario`, `${name}｜场景基线`, data.scenario ?? character.scenario);

    const embedded = data.character_book ?? character.character_book;
    collectBookObject(out, embedded, `embedded:${id}`, `${name}｜内嵌世界书`, 'character_worldbook');

    const ext = data.extensions && typeof data.extensions === 'object' ? data.extensions : (character.extensions || {});
    const bound = text(ext.world || data.world || character.world || '');
    return bound ? [bound] : [];
}

export function flattenWorldInfoEntries(book) {
    if (!book || typeof book !== 'object') return [];
    const entries = book.entries && typeof book.entries === 'object'
        ? Object.values(book.entries)
        : Array.isArray(book) ? book : [];
    return entries
        .filter(entry => entry && typeof entry === 'object' && entry.disable !== true && entry.enabled !== false)
        .map(entry => ({
            uid: text(entry.uid ?? entry.id ?? entry.comment ?? ''),
            comment: text(entry.comment ?? ''),
            content: text(entry.content ?? entry.text ?? ''),
        }))
        .filter(row => row.content);
}

function collectBookObject(out, book, sourceId, title, sourceType = 'world_info') {
    const rows = flattenWorldInfoEntries(book);
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        addSource(
            out,
            sourceType,
            `${sourceId}:${row.uid || i}`,
            `${title}${row.comment ? `｜${row.comment}` : ''}`,
            row.content,
        );
    }
}

async function loadNamedWorldInfo(ctx, out, names, sourceType) {
    if (typeof ctx?.loadWorldInfo !== 'function') return;
    const unique = [...new Set((Array.isArray(names) ? names : []).map(text).filter(Boolean))];
    for (const name of unique) {
        try {
            const book = await ctx.loadWorldInfo(name);
            collectBookObject(out, book, `book:${name}`, name, sourceType);
        } catch {
            // Missing/renamed lorebook should not make memory extraction fail.
        }
    }
}

function resolveCurrentCharacters(ctx) {
    const chars = Array.isArray(ctx?.characters) ? ctx.characters : [];
    const result = [];
    const add = c => { if (c && typeof c === 'object' && !result.includes(c)) result.push(c); };

    if (ctx?.groupId) {
        const groups = Array.isArray(ctx.groups) ? ctx.groups : [];
        const group = groups.find(g => String(g?.id) === String(ctx.groupId));
        const refs = Array.isArray(group?.members) ? group.members : [];
        for (const ref of refs) {
            const key = text(typeof ref === 'object' ? (ref.avatar || ref.name || ref.id) : ref);
            if (!key) continue;
            add(chars.find(c => {
                const d = characterData(c);
                return [d.avatar, c.avatar, d.name, c.name, d.id, c.id].some(v => text(v) === key);
            }));
        }
    } else {
        const id = ctx?.characterId;
        if (id !== undefined && id !== null && chars[id]) add(chars[id]);
        if (!result.length && ctx?.name2) add(chars.find(c => getCharacterName(c) === text(ctx.name2)));
    }
    return result;
}

function extractWorldInfoPromptText(promptResult) {
    if (!promptResult) return '';
    if (typeof promptResult === 'string') return promptResult;
    const parts = [
        promptResult.worldInfoString,
        promptResult.worldInfoBefore,
        promptResult.worldInfoAfter,
    ].map(text).filter(Boolean);
    return [...new Set(parts)].join('\n\n');
}

/**
 * Collect only current, semantically relevant baseline sources:
 * - active Persona description;
 * - current character/group-member cards and embedded books;
 * - Persona lorebook, character-bound lorebook, chat-bound lorebook;
 * - currently activated World Info as a conservative fallback for global/selective lore.
 * It intentionally never enumerates every lorebook in the account.
 */
export async function collectSemanticBaselineSources(ctx, { includeActiveWorldInfo = true } = {}) {
    const out = [];
    Object.defineProperty(out, '__seen', { value: new Set(), enumerable: false });

    const pu = ctx?.powerUserSettings || {};
    addSource(out, 'persona', 'active-persona', '当前 Persona', pu.persona_description);

    const boundBooks = [];
    for (const character of resolveCurrentCharacters(ctx)) {
        boundBooks.push(...collectCharacterText(out, character));
    }

    const personaBook = text(pu.persona_description_lorebook);
    if (personaBook) await loadNamedWorldInfo(ctx, out, [personaBook], 'persona_worldbook');
    if (boundBooks.length) await loadNamedWorldInfo(ctx, out, boundBooks, 'character_worldbook');

    const chatBook = text(ctx?.chatMetadata?.world_info);
    if (chatBook) await loadNamedWorldInfo(ctx, out, [chatBook], 'chat_worldbook');

    if (includeActiveWorldInfo && typeof ctx?.getWorldInfoPrompt === 'function') {
        try {
            const result = await ctx.getWorldInfoPrompt(ctx.chat || [], Number(ctx.maxContext) || 8192, true);
            addSource(out, 'active_world_info', 'activated-current-context', '当前激活 World Info', extractWorldInfoPromptText(result));
        } catch {
            // Some host/provider combinations can fail a dry-run. Bound sources still remain usable.
        }
    }

    return out;
}
