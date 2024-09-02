/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { IrcAction } from "./IrcAction";

import ircFormatting = require("../irc/formatting");
import { Intent, MediaProxy } from "matrix-appservice-bridge";
import escapeStringRegexp from "escape-string-regexp";
import logging from "../logging";
const log = logging("MatrixAction");

export enum ActionType {
    Audio = "audio",
    Command = "command",
    Emote = "emote",
    File = "file",
    Image = "image",
    Message = "message",
    Notice = "notice",
    Topic = "topic",
    Video = "video",
}

const EVENT_TO_TYPE: Record<string, ActionType> = {
    "m.room.message": ActionType.Message,
    "m.room.topic": ActionType.Topic,
};

const ACTION_TYPE_TO_MSGTYPE: Record<ActionType, string|undefined> = {
    audio: undefined,
    command: undefined,
    emote: "m.emote",
    file: undefined,
    image: undefined,
    message: "m.text",
    notice: "m.notice",
    topic: undefined,
    video: undefined,
};

const MSGTYPE_TO_TYPE: {[mxKey: string]: ActionType} = {
    "m.emote": ActionType.Emote,
    "m.notice": ActionType.Notice,
    "m.image": ActionType.Image,
    "m.video": ActionType.Video,
    "m.audio": ActionType.Audio,
    "m.file": ActionType.File,
};

const PILL_MIN_LENGTH_TO_MATCH = 4;
const MAX_MATCHES = 5;

export interface MatrixMessageEvent {
    type: string;
    sender: string;
    room_id: string;
    event_id: string;
    content: {
        "m.relates_to"?: {
            "m.in_reply_to"?: {
                event_id: string;
            };
            // edits
            "rel_type"?: string;
            "event_id": string;
        };
        "m.new_content"?: {
            body: string;
            msgtype: string;
        };
        body?: string;
        topic?: string;
        format?: string;
        formatted_body?: string;
        msgtype: string;
        url?: string;
        info?: {
            size: number;
        };
    };
    origin_server_ts: number;
}

const MentionRegex = function(matcher: string): RegExp {
    const WORD_BOUNDARY = "^|:|#|```|\\s|'|<|>|;|&|$|,";
    return new RegExp(
        `(${WORD_BOUNDARY})(@?(${matcher}))(?=${WORD_BOUNDARY})`,
        "igm"
    );
}

export class MatrixAction {

    constructor(
        public readonly type: ActionType,
        public text: string|null = null,
        public htmlText: string|null = null,
        public readonly ts: number = 0,
        public replyEvent?: string,
        private mediaProxy?: MediaProxy,
    ) { }

    public get msgType() {
        return (ACTION_TYPE_TO_MSGTYPE as {[key: string]: string|undefined})[this.type];
    }

    public async formatMentions(nickUserIdMap: Map<string, string>, intent: Intent) {
        if (!this.text) {
            return;
        }
        const nicks = [...nickUserIdMap.keys()];
        const regexString = `(${nicks.map((value) => escapeStringRegexp(value)).join("|")})`;
        const usersRegex = MentionRegex(regexString);
        const matched = new Set(); // lowercased nicknames we have matched already.
        let match;
        for (let i = 0; i < MAX_MATCHES && (match = usersRegex.exec(this.text)) !== null; i++) {
            let matchName = match[2];
            // Deliberately have a minimum length to match on,
            // so we don't match smaller nicks accidentally.
            if (matchName.length < PILL_MIN_LENGTH_TO_MATCH || matched.has(matchName.toLowerCase())) {
                continue;
            }
            let userId = nickUserIdMap.get(matchName);
            if (userId === undefined) {
                // We might need to search case-insensitive.
                const nick = nicks.find((n) =>
                    n.toLowerCase() === matchName.toLowerCase()
                );
                if (nick === undefined) {
                    continue;
                }
                userId = nickUserIdMap.get(nick);
                matchName = nick;
            }

            if (!userId) {
                continue
            }

            // If this message is not HTML, we should make it so.
            if (!this.htmlText) {
                // This looks scary and unsafe, but further down we check
                // if `text` contains any HTML and escape + set `htmlText` appropriately.
                this.htmlText = this.text;
            }
            userId = ircFormatting.escapeHtmlChars(userId);

            /* Due to how Element and friends do push notifications,
            we need the plain text to match something.*/
            let identifier;
            try {
                identifier = (await intent.getProfileInfo(userId, 'displayname', true)).displayname || undefined;
            }
            catch (e) {
                // This shouldn't happen, but let's not fail to match if so.
            }

            if (identifier === undefined) {
                // Fallback to userid.
                identifier = userId.substring(1, userId.indexOf(":"));
            }

            const regex = MentionRegex(escapeStringRegexp(matchName));
            this.htmlText = this.htmlText.replace(regex,
                `$1<a href="https://matrix.to/#/${userId}">`+
                `${ircFormatting.escapeHtmlChars(identifier)}</a>`
            );
            this.text = this.text.replace(regex, `$1${identifier}`);
            // Don't match this name twice, we've already replaced all entries.
            matched.add(matchName.toLowerCase());
        }
    }

    public static async fromEvent(event: MatrixMessageEvent, mediaProxy: MediaProxy, filename?: string) {
        event.content = event.content || {};
        let type = EVENT_TO_TYPE[event.type] || "message"; // mx event type to action type
        let text = event.content.body;
        let htmlText = null;

        if (event.type === "m.room.topic") {
            text = event.content.topic;
        }
        else if (event.type === "m.room.message") {
            if (event.content.msgtype === 'm.text' && event.content.body?.startsWith('!irc ')) {
                // This might be a command
                type = ActionType.Command;
                return new MatrixAction(type, text, null, event.origin_server_ts, event.event_id);
            }
            if (event.content.format === "org.matrix.custom.html") {
                htmlText = event.content.formatted_body;
            }
            if (MSGTYPE_TO_TYPE[event.content.msgtype]) {
                type = MSGTYPE_TO_TYPE[event.content.msgtype];
            }
            const isFile = ["m.image", "m.file", "m.video", "m.audio"].includes(event.content.msgtype);
            if (isFile && event.content.url) {
                let fileSize = "";
                if (event.content.info && event.content.info.size &&
                        typeof event.content.info.size === "number") {
                    fileSize = "(" + Math.round(event.content.info.size / 1024) + "KiB)";
                }

                const url = await mediaProxy.generateMediaUrl(event.content.url);
                if (!filename && event.content.body && /\S*\.[\w\d]{2,4}$/.test(event.content.body)) {
                    // Add filename to url if body is a filename.
                    filename = event.content.body;
                }

                if (filename) {
                    text = `${fileSize} < ${url} >`;
                }
                else {
                    fileSize = fileSize ? ` ${fileSize}` : "";
                    // If not a filename, print the body
                    text = `${event.content.body}${fileSize} < ${url} >`;
                }
            }
        }
        return new MatrixAction(type, text, htmlText, event.origin_server_ts);
    }

    public static fromIrcAction(ircAction: IrcAction) {
        switch (ircAction.type) {
            case "message":
            case "emote":
            case "notice": {
                const htmlText = ircFormatting.ircToHtml(ircAction.text);
                return new MatrixAction(
                    ircAction.type as ActionType,
                    ircFormatting.stripIrcFormatting(ircAction.text),
                    // only set HTML text if we think there is HTML, else the bridge
                    // will send everything as HTML and never text only.
                    ircAction.text !== htmlText ? htmlText : undefined
                );
            }
            case "topic":
                return new MatrixAction(ActionType.Topic, ircAction.text);
            default:
                log.error("MatrixAction.fromIrcAction: Unknown action: %s", ircAction.type);
                return null;
        }
    }
}
