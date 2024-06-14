
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

import * as ircFormatting from "../irc/formatting";
import { MatrixAction } from "./MatrixAction";
import logging from "../logging";
const log = logging("MatrixAction");

const ACTION_TYPES = ["message", "emote", "topic", "notice"];
type IrcActionType = "message"|"emote"|"topic"|"notice";

export class IrcAction {
    constructor (
        public readonly type: IrcActionType,
        public text: string,
        public readonly ts: number = 0 ) {
        if (!ACTION_TYPES.includes(type)) {
            throw new Error("Unknown IrcAction type: " + type);
        }
    }

    public static fromMatrixAction(matrixAction: MatrixAction): IrcAction|null {
        switch (matrixAction.type) {
            case "message":
            case "emote":
            case "notice":
                if (matrixAction.text === null) {
                    break;
                }
                if (matrixAction.htmlText) {
                    const ircText = ircFormatting.htmlToIrc(matrixAction.htmlText)
                        ?? ircFormatting.markdownCodeToIrc(matrixAction.text)
                        ?? matrixAction.text; // fallback if needed.
                    if (ircText === null) {
                        throw Error("ircText is null");
                    }
                    // irc formatted text is the main text part
                    return new IrcAction(matrixAction.type, ircText, matrixAction.ts)
                }
                return new IrcAction(matrixAction.type, matrixAction.text, matrixAction.ts);
            case "image":
                return new IrcAction(
                    "message", "" + matrixAction.text, matrixAction.ts
                );
            case "video":
                return new IrcAction(
                    "message", "" + matrixAction.text, matrixAction.ts
                );
            case "audio":
                return new IrcAction(
                    "message", "" + matrixAction.text, matrixAction.ts
                );
            case "file":
                return new IrcAction("message", "" + matrixAction.text, matrixAction.ts);
            case "topic":
                if (matrixAction.text === null) {
                    break;
                }
                return new IrcAction(matrixAction.type, matrixAction.text, matrixAction.ts);
            default:
                log.error("IrcAction.fromMatrixAction: Unknown action: %s", matrixAction.type);
        }
        return null;
    }
}
