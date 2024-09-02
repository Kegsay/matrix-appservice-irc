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

import { getLogger } from "../logging";
import { illegalCharactersRegex} from "./BridgedClient";
import { IrcClientConfig } from "../models/IrcClientConfig";
import { renderTemplate } from "../util/Template";

const log = getLogger("IrcServer");

export type MembershipSyncKind = "incremental"|"initial";

export interface IrcServerConfig {
    // These are determined to be always defined or possibly undefined
    // by the existence of the keys in IrcServer.DEFAULT_CONFIG.
    name?: string;
    port?: number;
    icon?: string;
    ca?: string;
    networkId?: string;
    ssl?: boolean;
    sslselfsign?: boolean;
    sasl?: boolean;
    tlsOptions?: Record<string, unknown>;
    password?: string;
    allowExpiredCerts?: boolean;
    additionalAddresses?: string[];
    onlyAdditionalAddresses: boolean;
    dynamicChannels: {
        enabled: boolean;
        published: boolean;
        useHomeserverDirectory?: boolean;
        createAlias: boolean;
        joinRule: "public"|"invite";
        federate?: boolean;
        aliasTemplate: string;
        whitelist?: string[];
        exclude?: string[];
        roomVersion?: string;
    };
    quitDebounce: {
        enabled: boolean;
        quitsPerSecond: number;
        delayMinMs: number;
        delayMaxMs: number;
    };
    mappings: {
        [channel: string]: {
            roomIds: string[];
            key?: string;
        };
    };
    modePowerMap?: {[mode: string]: number};
    sendConnectionMessages: boolean;
    botConfig: {
        nick: string;
        joinChannelsIfNoUsers: boolean;
        enabled: boolean;
        password?: string;
        username: string;
    };
    privateMessages: {
        enabled: boolean;
        exclude: string[];
        federate: boolean;
    };
    matrixClients: {
        userTemplate: string;
        displayName: string;
        joinAttempts: number;
    };
    ircClients: {
        nickTemplate: string;
        maxClients: number;
        idleTimeout: number;
        reconnectIntervalMs: number;
        concurrentReconnectLimit: number;
        allowNickChanges: boolean;
        ipv6: {
            only: boolean;
            prefix?: string;
            blocks?: {
                homeserver: string;
                startFrom: string;
            }[]
        };
        lineLimit: number;
        userModes?: string;
        realnameFormat?: "mxid"|"reverse-mxid";
        pingTimeoutMs: number;
        pingRateMs: number;
        kickOn: {
            channelJoinFailure: boolean;
            ircConnectionFailure: boolean;
            userQuit: boolean;
        }
    };
    excludedUsers: Array<
        {
            regex: string;
            kickReason?: string;
        }
    >;
    membershipLists: {
        enabled: boolean;
        floodDelayMs: number;
        ignoreIdleUsersOnStartup?: {
            enabled: true;
            idleForHours: number;
            exclude: string;
        };
        global?: {
            ircToMatrix: {
                initial: boolean;
                incremental: boolean;
                requireMatrixJoined: boolean;
            };
            matrixToIrc: {
                initial: boolean;
                incremental: boolean;
            };
        };
        channels?: {
            channel: string;
            ircToMatrix: {
                initial: boolean;
                incremental: boolean;
                requireMatrixJoined: boolean;
            };
        }[];
        rooms?: {
            room: string;
            matrixToIrc: {
                initial: boolean;
                incremental: boolean;
            };
        }[];
    };
}

const IRC_DEFAULT_INSECURE_PORT = 6667;
const IRC_DEFAULT_SECURE_PORT = 6697;

/*
 * Represents a single IRC server from config.yaml
 */
export class IrcServer {
    private addresses: string[] = [];
    private excludedUsers: { regex: RegExp; kickReason?: string }[] = [];
    private idleUsersStartupExcludeRegex?: RegExp;
    private enforceReconnectInterval = true;
    /**
     * Construct a new IRC Server.
     * @constructor
     * @param {string} domain : The IRC network address
     * @param {Object} serverConfig : The config options for this network.
     * @param {string} homeserverDomain : The domain of the homeserver
     * e.g "matrix.org"
     * @param {number} expiryTimeSeconds : How old a matrix message can be
     * before it is considered 'expired' and not sent to IRC. If 0, messages
     * will never expire.
     */
    constructor(public domain: string, public config: IrcServerConfig,
                public readonly homeserverDomain: string, private expiryTimeSeconds: number = 0) {
        this.reconfigure(config, expiryTimeSeconds);
    }

    /**
     * Get how old a matrix message can be (in seconds) before it is considered
     * 'expired' and not sent to IRC.
     * @return {Number} The number of seconds. If 0, they never expire.
     */
    public getExpiryTimeSeconds() {
        return this.expiryTimeSeconds;
    }

    /**
     * Get a string that represents the human-readable name for a server.
     * @return {string} this.config.name if truthy, otherwise it will return
     * an empty string.
     */
    public getReadableName() {
        return this.config.name ?? "";
    }

    /**
     * Get an icon to represent the network
     * The icon URL, if configured.
     */
    public getIcon(): string|undefined {
        return this.config.icon;
    }

    /**
     * Return a random server domain from the default and additional addresses.
     * @return {string}
     */
    public randomDomain(): string {
        // This cannot return undefined because the construtor and .reconfigure()
        // ensure that `addresses` isn't an empty array.
        return this.addresses[
            Math.floor(Math.random() * this.addresses.length)
        ];
    }

    /**
     * Returns the network ID of this server, which should be unique across all
     * IrcServers on the bridge. Defaults to the domain of this IrcServer.
     * @return {string} this.config.networkId || this.domain
     */
    public getNetworkId() {
        return this.config.networkId || this.domain;
    }

    /**
     * Returns whether the server is configured to wait getQuitDebounceDelayMs before
     * parting a user that has disconnected due to a net-split.
     * @return {Boolean} this.config.quitDebounce.enabled.
     */
    public shouldDebounceQuits() {
        return this.config.quitDebounce.enabled;
    }

    /**
     * Get a random interval to delay a quits for when debouncing. Will be between
     * `delayMinMs` and `delayMaxMs`
     */
    public getQuitDebounceDelay(): number {
        const { delayMaxMs, delayMinMs } = this.config.quitDebounce;
        return delayMinMs + (
            delayMaxMs - delayMinMs
        ) * Math.random();
    }

    /**
     * Get the rate of maximum quits received per second before a net-split is
     * detected. If the rate of quits received becomes higher that this value,
     * a net split is considered ongoing.
     * @return {number}
     */
    public getDebounceQuitsPerSecond() {
        return this.config.quitDebounce.quitsPerSecond;
    }

    /**
     * Get a map that converts IRC user modes to Matrix power levels.
     * @return {Object}
     */
    public getModePowerMap() {
        return this.config.modePowerMap || {};
    }

    public getHardCodedRoomIds() {
        const roomIds = new Set<string>();
        for (const mapping of Object.values(this.config.mappings)) {
            for (const roomId of mapping.roomIds) {
                roomIds.add(roomId);
            }
        }
        return Array.from(roomIds.keys());
    }

    public getChannelKey(channel: string) {
        return this.config.mappings[channel]?.key;
    }

    public shouldSendConnectionNotices() {
        return this.config.sendConnectionMessages;
    }

    public isBotEnabled() {
        return this.config.botConfig.enabled;
    }

    public getUserModes() {
        return this.config.ircClients.userModes || "";
    }

    public getRealNameFormat(): "mxid"|"reverse-mxid" {
        return this.config.ircClients.realnameFormat || "mxid";
    }

    public getJoinRule() {
        return this.config.dynamicChannels.joinRule;
    }


    public shouldFederatePMs() {
        return this.config.privateMessages.federate;
    }

    public getMemberListFloodDelayMs() {
        return this.config.membershipLists.floodDelayMs;
    }

    public shouldFederate() {
        return this.config.dynamicChannels.federate;
    }
    public forceRoomVersion() {
        return this.config.dynamicChannels.roomVersion;
    }

    public getPort() {
        return this.config.port ?? (this.useSsl() ? IRC_DEFAULT_SECURE_PORT : IRC_DEFAULT_INSECURE_PORT);
    }

    public isInWhitelist(userId: string) {
        return this.config.dynamicChannels.whitelist?.includes(userId) ?? true;
    }

    public getSecureOptions() {
        // Return an empty object here if not defined, as a falsy secure opts will disable SSL.
        return this.config.tlsOptions ?? {};
    }

    public useSsl() {
        return Boolean(this.config.ssl);
    }

    public useSslSelfSigned() {
        return Boolean(this.config.sslselfsign);
    }

    public useSasl() {
        return Boolean(this.config.sasl);
    }

    public allowExpiredCerts() {
        return Boolean(this.config.allowExpiredCerts);
    }

    public getIdleTimeout() {
        return this.config.ircClients.idleTimeout;
    }

    public toggleReconnectInterval(enable: boolean) {
        this.enforceReconnectInterval = enable;
    }

    public getReconnectIntervalMs() {
        return this.enforceReconnectInterval ? this.config.ircClients.reconnectIntervalMs : 0;
    }

    public getConcurrentReconnectLimit() {
        return this.config.ircClients.concurrentReconnectLimit;
    }

    public getMaxClients() {
        return this.config.ircClients.maxClients;
    }

    public shouldPublishRooms() {
        return this.config.dynamicChannels.published;
    }

    public shouldPublishRoomsToHomeserverDirectory() {
        return this.config.dynamicChannels.useHomeserverDirectory;
    }

    public allowsNickChanges(): boolean {
        return this.config.ircClients.allowNickChanges;
    }

    public getBotNickname(): string {
        return this.config.botConfig.nick;
    }

    public createBotIrcClientConfig(): IrcClientConfig {
        return IrcClientConfig.newConfig(
            null, this.domain, this.config.botConfig.nick, this.config.botConfig.username,
            this.config.botConfig.password
        );
    }

    public getIpv6Prefix(): string | undefined {
        return this.config.ircClients.ipv6.prefix;
    }

    public getIpv6Only(): boolean {
        return this.config.ircClients.ipv6.only;
    }

    public getLineLimit(): number {
        return this.config.ircClients.lineLimit;
    }

    public getJoinAttempts(): number {
        return this.config.matrixClients.joinAttempts;
    }

    public isExcludedChannel(channel: string): boolean {
        return this.config.dynamicChannels.exclude?.includes(channel) ?? false;
    }

    public isExcludedUser(userId: string) {
        return this.excludedUsers.find((exclusion) => exclusion.regex.test(userId));
    }

    public get ignoreIdleUsersOnStartup(): boolean {
        return this.config.membershipLists.ignoreIdleUsersOnStartup?.enabled ?? false;
    }

    public get ignoreIdleUsersOnStartupAfterMs(): number {
        return (this.config.membershipLists.ignoreIdleUsersOnStartup?.idleForHours || 0) * 1000 * 60 * 60;
    }

    public get ignoreIdleUsersOnStartupExcludeRegex(): RegExp | undefined {
        return this.idleUsersStartupExcludeRegex;
    }

    public get aliasTemplateHasHashPrefix(): boolean {
        return this.config.dynamicChannels.aliasTemplate.startsWith("#") ?? false;
    }

    /**
     * The amount of time to allow for inactivty on the connection, before considering the connection
     * dead. This usually happens if the IRCd doesn't ping us.
     */
    public get pingTimeout(): number {
        return this.config.ircClients.pingTimeoutMs;
    }

    /**
     * The rate at which to send pings to the IRCd if the client is being quiet for a while.
     * Whilst the IRCd *should* be sending pings to us to keep the connection alive, it appears
     * that sometimes they don't get around to it and end up ping timing us out.
    */
    public get pingRateMs(): number {
        return this.config.ircClients.pingRateMs;
    }

    public canJoinRooms(userId: string): boolean {
        return (
            this.config.dynamicChannels.enabled &&
            (this.getJoinRule() === "public" || this.isInWhitelist(userId))
        );
    }

    // check if this server dynamically create rooms with aliases.
    public createsDynamicAliases(): boolean {
        return (
            this.config.dynamicChannels.enabled &&
            this.config.dynamicChannels.createAlias
        );
    }

    // check if this server dynamically creates rooms which are joinable via an alias only.
    public createsPublicAliases(): boolean {
        return (
            this.createsDynamicAliases() &&
            this.getJoinRule() === "public"
        );
    }

    public allowsPms(): boolean {
        return this.config.privateMessages.enabled;
    }

    public shouldSyncMembershipToIrc(kind: MembershipSyncKind, roomId?: string): boolean {
        return this.shouldSyncMembership(kind, roomId, true);
    }

    public shouldSyncMembershipToMatrix(kind: MembershipSyncKind, channel: string): boolean {
        return this.shouldSyncMembership(kind, channel, false);
    }

    private shouldSyncMembership(kind: MembershipSyncKind, identifier: string|undefined, toIrc: boolean): boolean {
        if (!["incremental", "initial"].includes(kind)) {
            throw new Error("Bad kind: " + kind);
        }
        if (!this.config.membershipLists.enabled) {
            return false;
        }
        let shouldSync = this.config.membershipLists.global?.[
            toIrc ? "matrixToIrc" : "ircToMatrix"
        ][kind] ?? false;

        if (!identifier) {
            return shouldSync;
        }

        // check for specific rules for the room id / channel
        if (toIrc) {
            // room rules clobber global rules
            const room = this.config.membershipLists.rooms?.find(r => r.room === identifier);
            if (room?.matrixToIrc) {
                shouldSync = room.matrixToIrc[kind];
            }
        }
        else {
            // channel rules clobber global rules
            const chan = this.config.membershipLists.channels?.find(c => c.channel === identifier);
            if (chan?.ircToMatrix) {
                shouldSync = chan.ircToMatrix[kind];
            }
        }

        return shouldSync;
    }

    /**
     * Does the server/channel require all Matrix users to be joined?
     * @param channel The IRC channel.
     * @returns True if the server requires all Matrix users to be joined.
     */
    public shouldRequireMatrixUserJoined(channel: string): boolean {
        const chan = this.config.membershipLists.channels?.find(c => c.channel === channel);
        if (typeof chan?.ircToMatrix?.requireMatrixJoined === "boolean") {
            return chan.ircToMatrix.requireMatrixJoined;
        }
        return this.config.membershipLists.global?.ircToMatrix.requireMatrixJoined ?? false;
    }

    public shouldJoinChannelsIfNoUsers(): boolean {
        return this.config.botConfig.joinChannelsIfNoUsers;
    }

    public isMembershipListsEnabled(): boolean {
        return this.config.membershipLists.enabled;
    }

    public getUserLocalpart(nick: string): string {
        // the template is just a literal string with special vars; so find/replace
        // the vars and strip the @
        return renderTemplate(this.config.matrixClients.userTemplate, {
            server: this.domain,
            nick,
        }).substring(1); // the first character is guaranteed by config schema to be '@'
    }

    public claimsUserId(userId: string): boolean {
        // the server claims the given user ID if the ID matches the user ID template.
        const regex = IrcServer.templateToRegex(
            this.config.matrixClients.userTemplate,
            {
                "$SERVER": this.domain
            },
            {
                "$NICK": "(.*)"
            },
            ":" + IrcServer.escapeRegExp(this.homeserverDomain)
        );
        return new RegExp(regex).test(userId);
    }

    public getNickFromUserId(userId: string): string | null {
        // extract the nick from the given user ID
        const regex = IrcServer.templateToRegex(
            this.config.matrixClients.userTemplate,
            {
                "$SERVER": this.domain
            },
            {
                "$NICK": "(.*?)"
            },
            ":" + IrcServer.escapeRegExp(this.homeserverDomain)
        );
        const match = new RegExp(regex).exec(userId);
        if (!match) {
            return null;
        }
        return match[1];
    }

    public getUserIdFromNick(nick: string): string {
        const template = this.config.matrixClients.userTemplate;
        return template.replace(/\$NICK/g, nick).replace(/\$SERVER/g, this.domain) +
            ":" + this.homeserverDomain;
    }

    public getDisplayNameFromNick(nick: string): string {
        const template = this.config.matrixClients.displayName;
        let displayName = template.replace(/\$NICK/g, nick);
        displayName = displayName.replace(/\$SERVER/g, this.domain);
        return displayName;
    }

    public claimsAlias(alias: string): boolean {
        // the server claims the given alias if the alias matches the alias template
        const regex = IrcServer.templateToRegex(
            this.config.dynamicChannels.aliasTemplate,
            {
                "$SERVER": this.domain
            },
            {
                "$CHANNEL": "#(.*)"
            },
            ":" + IrcServer.escapeRegExp(this.homeserverDomain)
        );
        return new RegExp(regex).test(alias);
    }

    public getChannelFromAlias(alias: string): string | null {
        // extract the channel from the given alias
        const regex = IrcServer.templateToRegex(
            this.config.dynamicChannels.aliasTemplate,
            {
                "$SERVER": this.domain
            },
            {
                "$CHANNEL": "([^:]*)"
            },
            ":" + IrcServer.escapeRegExp(this.homeserverDomain)
        );
        const match = new RegExp(regex).exec(alias);
        if (!match) {
            return null;
        }
        log.info("getChannelFromAlias -> %s -> %s -> %s", alias, regex, match[1]);
        return match[1];
    }

    public getAliasFromChannel(channel: string): string {
        if (!channel.startsWith("#") && !this.aliasTemplateHasHashPrefix) {
            throw Error('Cannot get an alias for a channel not starting with a hash');
        }
        const alias = renderTemplate(this.config.dynamicChannels.aliasTemplate, {
            channel,
            server: this.domain,
        });
        return alias + ":" + this.homeserverDomain;
    }

    public getNick(userId: string, displayName?: string): string {
        let localpart = userId.substring(1).split(":")[0];
        localpart = localpart.replace(illegalCharactersRegex, "");
        displayName = displayName ? displayName.replace(illegalCharactersRegex, "") : undefined;
        const display = [displayName, localpart].find((n) => Boolean(n));
        if (!display) {
            throw new Error("Could not get nick for user, all characters were invalid");
        }
        return renderTemplate(this.config.ircClients.nickTemplate, {
            userId, localpart, display
        });
    }

    public getAliasRegex(): string {
        return IrcServer.templateToRegex(
            this.config.dynamicChannels.aliasTemplate,
            {
                "$SERVER": this.domain // find/replace $server
            },
            {
                "$CHANNEL": ".*" // the nick is unknown, so replace with a wildcard
            },
            // Only match the domain of the HS
            ":" + IrcServer.escapeRegExp(this.homeserverDomain)
        );
    }

    public getUserRegex(): string {
        return IrcServer.templateToRegex(
            this.config.matrixClients.userTemplate,
            {
                "$SERVER": this.domain // find/replace $server
            },
            {
                "$NICK": ".*" // the nick is unknown, so replace with a wildcard
            },
            // Only match the domain of the HS
            ":" + IrcServer.escapeRegExp(this.homeserverDomain)
        );
    }

    public getIpv6BlockForHomeserver(homeserver: string): string|null {
        const result = this.config.ircClients.ipv6.blocks?.find(block => block.homeserver === homeserver);
        if (result) {
            return result.startFrom;
        }
        return null;
    }

    public static get DEFAULT_CONFIG(): IrcServerConfig {
        return {
            sendConnectionMessages: true,
            onlyAdditionalAddresses: false,
            quitDebounce: {
                enabled: false,
                quitsPerSecond: 5,
                delayMinMs: 3600000, // 1h
                delayMaxMs: 7200000, // 2h
            },
            botConfig: {
                nick: "appservicebot",
                username: "matrixbot",
                joinChannelsIfNoUsers: true,
                enabled: true
            },
            modePowerMap: {
                o: 50,
                v: 1,
            },
            privateMessages: {
                enabled: true,
                exclude: [],
                federate: true
            },
            dynamicChannels: {
                enabled: false,
                published: true,
                useHomeserverDirectory: false,
                createAlias: true,
                joinRule: "public",
                federate: true,
                aliasTemplate: "#irc_$SERVER_$CHANNEL",
                whitelist: [],
                exclude: []
            },
            mappings: {},
            excludedUsers: [],
            matrixClients: {
                userTemplate: "@$SERVER_$NICK",
                displayName: "$NICK",
                joinAttempts: -1,
            },
            ircClients: {
                nickTemplate: "M-$DISPLAY",
                maxClients: 30,
                idleTimeout: 172800,
                reconnectIntervalMs: 5000,
                concurrentReconnectLimit: 50,
                allowNickChanges: false,
                ipv6: {
                    only: false
                },
                lineLimit: 3,
                pingTimeoutMs: 1000 * 60 * 10,
                pingRateMs: 1000 * 60,
                kickOn: {
                    ircConnectionFailure: true,
                    channelJoinFailure: true,
                    userQuit: true
                }
            },
            membershipLists: {
                enabled: false,
                floodDelayMs: 10000, // 10s
                global: {
                    ircToMatrix: {
                        initial: false,
                        incremental: false,
                        requireMatrixJoined: false,
                    },
                    matrixToIrc: {
                        initial: false,
                        incremental: false
                    }
                },
                channels: [],
                rooms: []
            }
        }
    }

    public reconfigure(config: IrcServerConfig, expiryTimeSeconds = 0): void {
        log.info(`Reconfiguring ${this.domain}`);

        if (config.ca) {
            log.warn("** The IrcServer.ca is now deprecated, please use tlsOptions.ca. **");
            config.tlsOptions = {
                ...config.tlsOptions,
                ca: config.ca,
            };
        }

        if (config.ircClients.ipv6.blocks) {
            // Check those blocks
            const invalidBlocks = config.ircClients.ipv6.blocks.filter( block =>
                isNaN(parseInt(block.startFrom.replace(/:/g, ''), 16))
            ).map(block => block.homeserver).join(', ');
            if (invalidBlocks) {
                throw Error(`Invalid ircClients.ipv6.blocks entry(s): ${invalidBlocks}`);
            }
        }

        this.config = config;
        this.expiryTimeSeconds = expiryTimeSeconds;
        // This ensures that legacy mappings still work, but we prod the user to update.
        const stringMappings = Object.entries(config.mappings || {}).filter(([, data]) => {
            return Array.isArray(data);
        }) as unknown as [string, string[]][];

        if (stringMappings.length) {
            log.warn("** The IrcServer.mappings config schema has changed, allowing legacy format for now. **");
            log.warn("See https://github.com/matrix-org/matrix-appservice-irc/blob/master/CHANGELOG.md for details");
            for (const [channelId, roomIds] of stringMappings) {
                config.mappings[channelId] = { roomIds: roomIds }
            }
        }

        if (!this.aliasTemplateHasHashPrefix) {
            if (this.config.dynamicChannels.aliasTemplate !== "$CHANNEL") {
                throw Error(
                    "If no hash prefix is given in 'aliasTemplate', then the aliasTemplate must be exactly '$CHANNEL'"
                );
            }
            log.warn("You have configured your aliasTemplate to not include a prefix hash. This means that only " +
                "channels starting with a hash are supported by the bridge.")
        }

        this.addresses = config.additionalAddresses || [];
        // Don't include the original domain if not configured to.
        if (!config.onlyAdditionalAddresses) {
            this.addresses.push(this.domain);
        }
        else if (this.addresses.length === 0) {
            throw Error("onlyAdditionalAddresses is true, but no additional addresses are provided in the config");
        }
        this.excludedUsers = config.excludedUsers.map((excluded) => {
            return {
                ...excluded,
                regex: new RegExp(excluded.regex)
            }
        });

        this.idleUsersStartupExcludeRegex =
            this.config.membershipLists.ignoreIdleUsersOnStartup?.exclude ?
                new RegExp(this.config.membershipLists.ignoreIdleUsersOnStartup.exclude)
                : undefined;
    }

    private static templateToRegex(template: string, literalVars: {[key: string]: string},
                                   regexVars: {[key: string]: string}, suffix: string) {
        // The 'template' is a literal string with some special variables which need
        // to be find/replaced.
        let regex = template;
        for (const [varPlaceholder, replacement] of Object.entries(literalVars)) {
            regex = regex.replace(
                new RegExp(IrcServer.escapeRegExp(varPlaceholder), 'g'),
                replacement
            );
        }

        // at this point the template is still a literal string, so escape it before
        // applying the regex vars.
        regex = IrcServer.escapeRegExp(regex);
        // apply regex vars
        for (const [varPlaceholder, replacement] of Object.entries(regexVars)) {
            regex = regex.replace(
                // double escape, because we bluntly escaped the entire string before
                // so our match is now escaped.
                new RegExp(IrcServer.escapeRegExp(IrcServer.escapeRegExp(varPlaceholder)), 'g'),
                replacement
            );
        }

        suffix = suffix || "";
        return regex + suffix;
    }

    private static escapeRegExp(s: string) {
        // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
