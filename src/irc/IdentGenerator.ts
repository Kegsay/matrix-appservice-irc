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

import { Queue } from "../util/Queue";
import { getLogger } from "../logging";
import { DataStore } from "../datastore/DataStore";
import { MatrixUser } from "matrix-appservice-bridge";
import { IrcClientConfig } from "../models/IrcClientConfig";
import { IrcServer } from "./IrcServer";
import { renderTemplate } from "../util/Template";

const log = getLogger("IdentGenerator");

export class IdentGenerator {
    // The max length of <realname> in USER commands
    private static readonly MAX_REAL_NAME_LENGTH = 48;
    // The max length of <username> in USER commands
    public static readonly MAX_USER_NAME_LENGTH = 10;
    // The delimiter of the username.
    private static readonly USER_NAME_DELIMITER = "_";
    // The delimiter of the username.
    private static readonly MAX_USER_NAME_SUFFIX = 9999;

    private queue: Queue<{ matrixUser: MatrixUser; ircClientConfig: IrcClientConfig, unique: boolean}>;
    constructor (private readonly dataStore: DataStore) {
        // Queue of ident generation requests.
        // We need to queue them because otherwise 2 clashing user_ids could be assigned
        // the same ident value (won't be in the database yet)
        this.queue = new Queue((item) => {
            const {matrixUser, ircClientConfig, unique} = item;
            return this.process(matrixUser, ircClientConfig, unique);
        });
    }

    static switchAroundMxid(user: MatrixUser) {
        return user.host.split('.')
            .reverse()
            .join('.')
            .substring(0, 30) + (user.host.length > 30 ? ">:" : ":") + user.localpart;
    }

    /**
     * Get the IRC name info for this user.
     * @param {IrcClientConfig} clientConfig IRC client configuration info.
     * @param {MatrixUser} matrixUser Optional. The matrix user.
     * @return {Promise} Resolves to {
     *   username: 'username_to_use',
     *   realname: 'realname_to_use'
     * }
     */
    public async getIrcNames(ircClientConfig: IrcClientConfig, server: IrcServer, matrixUser?: MatrixUser):
        Promise<{username: string; realname: string}> {
        const username = ircClientConfig.getUsername();

        let realname: string;
        if (!matrixUser) {
            realname = username || "";
        }
        else if (server.getRealNameFormat() === "mxid") {
            realname = matrixUser.getId();
            log.warn("** The IrcClient.realnameFormat config schema has changed, allowing legacy format for now. **");
            log.warn("See https://github.com/matrix-org/matrix-appservice-irc/blob/master/CHANGELOG.md for details");
        }
        else if (server.getRealNameFormat() === "reverse-mxid") {
            realname = IdentGenerator.switchAroundMxid(matrixUser);
            log.warn("** The IrcClient.realnameFormat config schema has changed, allowing legacy format for now. **");
            log.warn("See https://github.com/matrix-org/matrix-appservice-irc/blob/master/CHANGELOG.md for details");
        }
        else {
            realname = renderTemplate(server.getRealNameFormat(), {
                userId: matrixUser.userId,
                localpart: matrixUser.localpart,
                display: matrixUser.getDisplayName() || "",
                reverseId: IdentGenerator.switchAroundMxid(matrixUser),
                ircUser: username || ""
            });
        }

        realname = IdentGenerator.sanitiseRealname(realname);
        realname = realname.substring(0, IdentGenerator.MAX_REAL_NAME_LENGTH);

        if (matrixUser) {
            if (username) {
                log.debug(
                    "Using cached ident username %s for %s on %s",
                    ircClientConfig.getUsername(), matrixUser.getId(), ircClientConfig.getDomain()
                );
                return {
                    username,
                    realname,
                };
            }
            try {
                log.debug(
                    "Pushing username generation request for %s on %s to the queue...",
                    matrixUser.getId(), ircClientConfig.getDomain()
                )
                const uname = await this.queue.enqueue(matrixUser.getId(), {
                    matrixUser: matrixUser,
                    ircClientConfig: ircClientConfig,
                    // IPv6 bridges do not need a unique username, as each user will
                    // have their own IPv6 address.
                    unique: !server.getIpv6Only(),
                }) as string;
                return {
                    username: uname,
                    realname: realname,
                };
            }
            catch (err) {
                log.error(
                    "Failed to generate ident username for %s on %s",
                    matrixUser.getId(), ircClientConfig.getDomain()
                )
                log.error(err.stack);
                throw err;
            }
        }

        return {
            username: IdentGenerator.sanitiseUsername(
                // the bridge bot won't have a matrix user. Username is *always* defined for the bot.
                username as string
            ),
            realname,
        };
    }

    // debugging: util.inspect()
    public inspect() {
        return `IdentGenerator queue length=${this.queue.size}`
    }

    private async process (matrixUser: MatrixUser, ircClientConfig: IrcClientConfig, unique: boolean) {
        const configDomain = ircClientConfig.getDomain();
        log.debug("Generating username for %s on %s", matrixUser.getId(), configDomain);
        let uname;
        if (unique) {
            uname = await this.generateIdentUsername(configDomain, matrixUser.getId());
        }
        else {
            // If the bridge is an IPv6 bridge, we just want to generate a valid username
            // rather than worrying too much about it being unique. The IPv6 address
            // ensures that the hostmask will be unique.
            uname = IdentGenerator.sanitiseUsername(
                matrixUser.getId().substring(1)
            ).substring(0, IdentGenerator.MAX_USER_NAME_LENGTH);
        }
        const existingConfig = await this.dataStore.getIrcClientConfig(matrixUser.getId(), configDomain);
        const config = existingConfig ? existingConfig : ircClientConfig;
        config.setUsername(uname);

        // persist to db here before releasing the lock on this request.
        await this.dataStore.storeIrcClientConfig(config);
        return config.getUsername();
    }

    /**
     * Generate a new IRC username for the given Matrix user on the given server.
     * @param {string} domain The IRC server domain
     * @param {string} userId The matrix user being bridged
     * @return {Promise} resolves to the username {string}.
     */
    private async generateIdentUsername(domain: string, userId: string) {
        // @foobar££stuff:domain.com  =>  foobar__stuff_domain_com
        let uname = IdentGenerator.sanitiseUsername(userId.substring(1));
        if (uname.length < IdentGenerator.MAX_USER_NAME_LENGTH) { // bwahaha not likely.
            return uname;
        }
        uname = uname.substring(0, IdentGenerator.MAX_USER_NAME_LENGTH);
        /* LONGNAM~1 ing algorithm:
        * foobar => foob~1 => foob~2 => ... => foob~9 => foo~10 => foo~11 => ...
        * f~9999 => FAIL.
        */

        const originalUname = uname;
        let suffix = await this.getSuffixForUsername(uname, domain);

        while (true) {
            // getSuffixForUsername should have ensured that this suffix isn't taken,
            // but just to be sure.
            const usr = await this.dataStore.getMatrixUserByUsername(domain, uname);
            if (usr && usr.getId() !== userId) { // occupied username!
                const res = IdentGenerator.modifyUsername(originalUname, suffix);
                uname = res.uname;
                suffix++;
                if (!res.result) {
                    throw Error("Ran out of entries: " + res.uname);
                }
            }
            else {
                if (!usr) {
                    log.info(
                        "Generated ident username %s for %s on %s",
                        uname, userId, domain
                    );
                }
                else {
                    log.info(
                        "Returning cached ident username %s for %s on %s",
                        uname, userId, domain
                    );
                }
                break;
            }
        }
        return uname;
    }

    /**
     * Get the next available suffix for a given complete username.
     * This function will find the correct suffix for a user in as fewest
     * DB calls as possible.
     * @param uname The IRC username
     * @param domain The IRC domain.
     */
    private async getSuffixForUsername(username: string, domain: string) {
        let suffixLength = 1;
        while (suffixLength <= Math.log10(IdentGenerator.MAX_USER_NAME_SUFFIX) + 1) {
            const prefix = username.substring(
            // myusername becomes myuserna
                0, username.length - IdentGenerator.USER_NAME_DELIMITER.length - suffixLength);
            // Look for all usernames starting with myuserna
            const countForPrefix = await this.dataStore.getCountForUsernamePrefix(domain, prefix);
            // is there myuserna_1 to myuserna_9
            if (countForPrefix < Math.pow(10, suffixLength) - 1) {
                // Take the next available suffix.
                return countForPrefix;
            }
            suffixLength++;
        }
        throw Error("Ran out of entries: " + username);
    }

    public static sanitiseUsername(username: string, replacementChar = "") {
        username = username.toLowerCase();
        // strip illegal chars according to RFC 1459 Sect 2.3.1
        // (technically it's any <nonwhite> ascii for <user> but meh)
        // also strip '_' since we use that as the delimiter
        username = username.replace(/[^A-Za-z0-9\]\[\^\\\{\}\-`]/g, replacementChar);
        // Whilst the RFC doesn't say you can't have special characters eg ("-") as the
        // first character of a USERNAME, empirically Freenode rejects connections
        // stating "Invalid username". Having  "-" is valid, so long as it isn't the first.
        // Prefix usernames with "M" if they start with a special character.
        if (/^[^A-Za-z]/.test(username)) {
            return "M" + username;
        }
        return username;
    }

    private static sanitiseRealname(realname: string) {
        // real name can be any old ASCII
        // eslint-disable-next-line no-control-regex
        return realname.replace(/[^\x00-\x7F]/g, "");
    }

    private static modifyUsername(uname: string, suffix: number): { result: boolean; uname: string} {
        const suffixString = `${this.USER_NAME_DELIMITER}${suffix}`;
        uname = `${uname.substring(0, this.MAX_USER_NAME_LENGTH - suffixString.length)}${suffixString}`;
        return { result: suffix <= this.MAX_USER_NAME_SUFFIX, uname }; // break out if '~10000'
    }
}
