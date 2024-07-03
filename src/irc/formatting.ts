import sanitizeHtml from "sanitize-html";
import he from "he";

const htmlNamesToColorCodes: {[color: string]: string[]} = {
    white:     ['00', '0'],
    black:     ['01', '1'],
    navy:      ['02', '2'],
    green:     ['03', '3'],
    red:       ['04', '4'],
    maroon:    ['05', '5'],
    purple:    ['06', '6'],
    orange:    ['07', '7'],
    yellow:    ['08', '8'],
    lime:      ['09', '9'],
    teal:      ['10'],
    aqua:      ['11'],
    blue:      ['12'],
    fuchsia:   ['13'],
    gray:      ['14'],
    lightgrey: ['15']
};

// These map the CSS color names to mIRC hex colors
const htmlNamesToHex: {[color: string]: string} = {
    white:     '#FFFFFF',
    black:     '#000000',
    navy:      '#00007F',
    green:     '#009300',
    red:       '#FF0000',
    maroon:    '#7F0000',
    purple:    '#9C009C',
    orange:    '#FC7F00',
    yellow:    '#FFFF00',
    lime:      '#00FC00',
    teal:      '#009393',
    aqua:      '#00FFFF',
    blue:      '#0000FC',
    fuchsia:   '#FF00FF',
    gray:      '#7F7F7F',
    lightgrey: '#D2D2D2'
};

// store the reverse mapping
const colorCodesToHtmlNames: {[colorCode: string]: string} = {};
const htmlNames = Object.keys(htmlNamesToColorCodes);
htmlNames.forEach((htmlName) => {
    htmlNamesToColorCodes[htmlName].forEach((colorNum: string) => {
        colorCodesToHtmlNames[colorNum] = htmlNamesToHex[htmlName];
    });
});

const STYLE_COLOR = '\u0003';
const STYLE_BOLD = '\u0002';
const STYLE_MONOSPACE = '\u0011';
const STYLE_ITALICS = '\u001d';
const STYLE_STRIKE = '\u001e';
const STYLE_UNDERLINE = '\u001f';
const STYLE_CODES = [STYLE_BOLD, STYLE_MONOSPACE, STYLE_ITALICS, STYLE_STRIKE, STYLE_UNDERLINE];
const RESET_CODE = '\u000f';
const REVERSE_CODE = '\u0016';

interface StyleState {
    color: string|null;
    bcolor: string|null;
    history: string[];
}

/**
 * This is used as the default state for irc to html conversion.
 * The color attributes (color and bcolor) can be:
 *  - null for no colour, or
 *  - a string with an HTML/CSS colour.
 *
 * @type {{color: (null|string), bcolor: (null|string), history: Array}}
 */
const STYLE_DEFAULT_STATE: StyleState = {
    "color": null, // The foreground colour.
    "bcolor": null, // The background colour.
    "history": [] // The history of opened tags. See the htmlTag function.
};

export function escapeHtmlChars(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/\u200B/g, "&ZeroWidthSpace;")
        .replace(/'/g, "&apos;");
}

/**
 * Given the state of the message, open or close an HTML tag with the
 * appropriate attributes.
 *
 * Tags are stored in an array, which is used as a stack.
 * Opening a tag is always pushed to the end. This can happen multiple times
 * for nested tags of the same type.
 * Closing a tag closes all tags up to the most recent corresponding tag in
 * the history, and re-opens the ones opened after. Nothing happens if the tag
 * doesn't exist.
 *
 * @param {Object} state Current state of a message
 * @param {string} name Name of the HTML tag.
 * @param {boolean} open Open or close the tag (optional) .
 *                       Detected automatically when omitted.
 * @returns {string} Text containing the relevant open/closing tags.
 */
export function htmlTag(state: StyleState, name: string, open?: boolean): string {
    let text = '';

    if (typeof open === 'undefined') {
        open = !state.history.includes(name);
    }

    if (open) {
        state.history.push(name);
        if (name === 'font') {
            // Create style from state
            let style = '';
            if (state.color) {
                style += ' color="' + state.color + '"';
            }
            if (state.bcolor) {
                style += ' data-mx-bg-color="' + state.bcolor + '"';
            }
            text = '<font' + style + '>';
        }
        else {
            text = '<' + name + '>';
        }
    }
    else {
        // Get tags that need to be closed
        const index = name === 'all' ? 0 : state.history.lastIndexOf(name);
        const tags = state.history.splice(index);

        // Close tags
        tags.reverse().forEach( function(t) {
            text += '</' + t + '>';
        });

        // Open tags again
        if (name !== 'all') {
            tags.slice(0, -1).forEach( function (t) {
                text += htmlTag(state, t, true);
            });
        }
    }
    return text;
}

export function stripIrcFormatting(text: string) {
    return text
        // eslint-disable-next-line no-control-regex
        .replace(/(\x03\d{0,2}(,\d{0,2})?)/g, '') // strip colors
        // eslint-disable-next-line no-control-regex
        .replace(/[\x0F\x02\x11\x16\x1F\x1D]/g, ''); // styles too
}

export function htmlToIrc(html?: string): string|null {
    if (!html) {
        return null;
    }

    // Sanitize the HTML first to allow us to regex parse this (which also does
    // things like case-sensitivity and spacing). Use he to decode any html entities
    // because we don't want those.
    let cleanHtml = he.decode(sanitizeHtml(html, {
        allowedTags: ["b", "code", "del", "i", "u", "strong", "font", "em"],
        allowedAttributes: {
            font: ["color"]
        }
    }));
    if (cleanHtml !== html) {
        // There are unrecognised tags. Let's play it safe and break, we can always
        // use the fallback text.
        return null;
    }

    // noddy find/replace on OPEN tags is possible now
    const replacements: [RegExp, string][] = [
        [/<b>/g, STYLE_BOLD], [/<u>/g, STYLE_UNDERLINE], [/<i>/g, STYLE_ITALICS],
        [/<strong>/g, STYLE_BOLD], [/<em>/g, STYLE_ITALICS],
        [/<del>/g, STYLE_STRIKE], [/<code>/g, STYLE_MONOSPACE],
    ];
    Object.keys(htmlNamesToColorCodes).forEach(function(htmlColor) {
        replacements.push([
            new RegExp('<font color="' + htmlColor + '">', 'g'),
            STYLE_COLOR + htmlNamesToColorCodes[htmlColor][0]
        ]);
    });
    for (let i = 0; i < replacements.length; i++) {
        const rep = replacements[i];
        cleanHtml = cleanHtml.replace(rep[0], rep[1]);
    }
    // this needs a single pass through to fix up the reset codes, as they
    // 'close' all open tags. This pass through checks which tags are open and
    // then reopens them after a reset code.
    const openStyleCodes = [];
    const closeTagsToStyle: {[tag: string]: string} = {
        "</b>": STYLE_BOLD,
        "</del>": STYLE_STRIKE,
        "</code>": STYLE_MONOSPACE,
        "</u>": STYLE_UNDERLINE,
        "</i>": STYLE_ITALICS,
        "</em>": STYLE_ITALICS,
        "</strong>": STYLE_BOLD
    };
    const closeTags = Object.keys(closeTagsToStyle);
    let replacement;
    for (let i = 0; i < cleanHtml.length; i++) {
        const ch = cleanHtml[i];
        if (STYLE_CODES.includes(ch)) {
            openStyleCodes.push(ch);
        }
        else if (ch === "<") {
            if (cleanHtml.indexOf("</font>", i) === i) {
                replacement = RESET_CODE + openStyleCodes.join("");
                cleanHtml = cleanHtml.replace(
                    "</font>", replacement
                );
                i += (replacement.length - 1);
            }
            else {
                for (let closeTagIndex = 0; closeTagIndex < closeTags.length; closeTagIndex++) {
                    const closeTag = closeTags[closeTagIndex];
                    if (cleanHtml.indexOf(closeTag, i) === i) {
                        // replace close tag with a reset and pop off the open
                        // formatting code, then reopen remaining tags
                        openStyleCodes.splice(openStyleCodes.indexOf(
                            closeTagsToStyle[closeTag]
                        ), 1);
                        replacement = RESET_CODE + openStyleCodes.join("");
                        cleanHtml = cleanHtml.replace(
                            closeTag, replacement
                        );
                        i += (replacement.length - 1);
                    }
                }
            }
        }
    }
    // sanitize any other tags that are left. We don't know how to handle 'em.
    cleanHtml = cleanHtml.replace(/<[^>]+>/gm, "");

    // unescape html characters
    const escapeChars: [RegExp, string][] = [
        [/&gt;/g, '>'], [/&lt;/g, '<'], [/&quot;/g, '"'], [/&amp;/g, '&']
    ];
    escapeChars.forEach(function(escapeSet) {
        cleanHtml = cleanHtml.replace(escapeSet[0], escapeSet[1]);
    });

    return cleanHtml;
}

export function ircToHtml(text: string): string {
    // Escape HTML characters and add reset character to close all tags at the end.
    text = escapeHtmlChars(text) + RESET_CODE;

    // Replace all mIRC formatting characters.
    // The color character can have arguments.
    // The regex matches:
    // - Any single 'simple' formatting character: \x02, \x11, \x1d, \x1e, \x1f, \x0f and
    //   \x16 for bold, italics, underline, strikethrough, reset and reverse respectively.
    // - The colour formatting character (\x03) followed by 0 to 2 digits for
    //   the foreground colour and (optionally) a comma and 1-2 digits for the
    //   background colour.
    // eslint-disable-next-line no-control-regex
    const colorRegex = /[\x02\x11\x1d\x1e\x1f\x0f\x16]|\x03(\d{0,2})(?:,(\d{1,2}))?/g;

    // Maintain a small state machine of which tags are open so we can close the right
    // ones on RESET codes and toggle appropriately if they do the same code again.
    let state = Object.assign({}, STYLE_DEFAULT_STATE);

    // Return message with codes replaced
    return text.replace(colorRegex, function(match, fg, bg) {
        let tags = '';

        // Modify state with the current matched formatting character
        switch (match[0]) {
            case STYLE_BOLD:
                return htmlTag(state, 'b');

            case STYLE_MONOSPACE:
                return htmlTag(state, 'code');

            case STYLE_STRIKE:
                return htmlTag(state, 'del');

            case STYLE_ITALICS:
                return htmlTag(state, 'i');

            case STYLE_UNDERLINE:
                return htmlTag(state, 'u');

            case REVERSE_CODE: {
                // Swap the foreground and background colours.
                const temp = state.color;
                state.color = state.bcolor;
                state.bcolor = temp;
                // Close and re-open the font tag.
                return htmlTag(state, 'font', false) + htmlTag(state, 'font', true);
            }

            case RESET_CODE:
                // Close tags
                tags = htmlTag(state, 'all', false);
                // Reset state
                state = Object.assign({}, STYLE_DEFAULT_STATE);
                return tags;

            case STYLE_COLOR:
                // Close font tag
                if (state.color || state.bcolor) {
                    tags += htmlTag(state, 'font', false);
                }
                // Foreground colour
                if (fg) {
                    state.color = colorCodesToHtmlNames[fg];
                }
                // Background colour
                if (bg) {
                    state.bcolor = colorCodesToHtmlNames[bg];
                }
                // Neither
                if (!fg && !bg) {
                    state.color = state.bcolor = null;
                }
                // Create font with style
                if (state.color || state.bcolor) {
                    tags += htmlTag(state, 'font', true);
                }
                return tags;

            // Unknown or ignored character
            default:
                return tags;
        }
    });
}

/**
 * Returns a trimmed string if the input text is a Markdown-style code block.
 * This is used to allow small code snippets to look nice in IRC and not be
 * transformed into an upload.
 */
export function markdownCodeToIrc(text: string): string|null {
    let trimmedText = text.trim();
    // If this post isn't all code, ignore it.
    if (!/^```.*\n.*```$/s.test(trimmedText)) {
        return null;
    }
    // Remove the first line (e.g. ```js) and the ``` at the end
    trimmedText = trimmedText.substring(trimmedText.indexOf("\n"), trimmedText.length - 3);
    // Trim whitespaces but not indentation
    trimmedText = trimmedText.replace(/^\s*?\n/, "").replace(/\s*$/, "");
    return trimmedText;
}

export function toIrcLowerCase(str: string, caseMapping: "strict-rfc1459"|"rfc1459" = "rfc1459") {
    const lower = str.toLowerCase();
    if (caseMapping === "rfc1459") {
        return lower.
            replace(/\[/g, "{").
            replace(/\]/g, "}").
            replace(/\\/g, "|").
            replace(/\^/g, "~");
    }
    else if (caseMapping === "strict-rfc1459") {
        return lower.
            replace(/\[/g, "{").
            replace(/\]/g, "}").
            replace(/\\/g, "|");
    }
    throw Error("Unknown case mapping");
}
