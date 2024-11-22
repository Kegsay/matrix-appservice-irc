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
import { QueuePool } from "../util/QueuePool";
import { BridgeRequest } from "../models/BridgeRequest";
import { IrcClientConfig } from "../models/IrcClientConfig";
import { IrcServer } from "../irc/IrcServer";
import { AgeCounters, MatrixUser, MatrixRoom } from "matrix-appservice-bridge";
import { BridgedClient, BridgedClientStatus } from "./BridgedClient";
import { IrcBridge } from "../bridge/IrcBridge";
import { IdentGenerator } from "./IdentGenerator";
import { Ipv6Generator } from "./Ipv6Generator";
import { IrcEventBroker } from "./IrcEventBroker";
import { DataStore } from "../datastore/DataStore";
import { Gauge } from "prom-client";
import QuickLRU from "quick-lru";
import { IRCConnectionError, IRCConnectionErrorCode } from "./ConnectionInstance";
import { IrcPoolClient } from "../pool-service/IrcPoolClient";
const log = getLogger("ClientPool");

const NICK_CACHE_SIZE = 256;
const BOT_CONNECTION_RETRY_TIME_MS = 2500;

interface ReconnectionItem {
    cli: BridgedClient;
    chanList: string[];
}

/*
 * Maintains a lookup of connected IRC clients. These connections are transient
 * and may be closed for a variety of reasons.
 */
export class ClientPool {
    private botClients: Map<string, BridgedClient>;
    private virtualClients: { [serverDomain: string]: {
        nicks: QuickLRU<string, BridgedClient>;
        userIds: Map<string, BridgedClient>;
        pending: Map<string, BridgedClient>;
    };};
    private reconnectQueues: { [serverDomain: string]: QueuePool<ReconnectionItem> };
    private identGenerator: IdentGenerator;
    private ipv6Generator: Ipv6Generator;
    private ircEventBroker: IrcEventBroker;
    constructor(
        private readonly ircBridge: IrcBridge,
        private readonly store: DataStore,
        private readonly redisPool?: IrcPoolClient
    ) {
        // The list of bot clients on servers (not specific users)
        this.botClients = new Map();

        // list of virtual users on servers
        this.virtualClients = { };

        this.reconnectQueues = { };

        this.identGenerator = new IdentGenerator(store);
        this.ipv6Generator = new Ipv6Generator(store);
        this.ircEventBroker = new IrcEventBroker(
            this.ircBridge.getAppServiceBridge(),
            this,
            this.ircBridge.ircHandler,
            this.ircBridge.getServers(),
        );
    }

    public nickIsVirtual(server: IrcServer, nick: string): boolean {
        if (!this.virtualClients[server.domain]) {
            return false;
        }

        if (this.getBridgedClientByNick(server, nick, true)) {
            return true;
        }

        // The client may not have signalled to us that it's connected, but it is connect*ing*.
        return this.virtualClients[server.domain].pending.has(nick)
    }

    public killAllClients(reason?: string): Promise<unknown> {
        const domains = Object.keys(this.virtualClients);
        const clients: (BridgedClient|undefined)[] = domains.map((domain) =>
            [
                ...this.virtualClients[domain].userIds.values(),
                this.botClients.get(domain),
            ]
        ).flat();
        this.ircEventBroker.stop();
        return Promise.all(clients.map((client) => client?.kill(reason)));
    }

    public getOrCreateReconnectQueue(server: IrcServer): QueuePool<ReconnectionItem> | null {
        if (server.getConcurrentReconnectLimit() === 0) {
            return null;
        }
        let q = this.reconnectQueues[server.domain];
        if (q === undefined) {
            q = this.reconnectQueues[server.domain] = new QueuePool(
                server.getConcurrentReconnectLimit(),
                (item) => {
                    log.info(`Reconnecting client. ${q.waitingItems} left.`);
                    return this.reconnectClient(item);
                }
            );
        }
        return q;
    }

    public setBot(server: IrcServer, client: BridgedClient) {
        this.botClients.set(server.domain, client);
    }

    public getBot(server: IrcServer) {
        return this.botClients.get(server.domain);
    }

    /**
     * Discover any clients connected from a previous session when
     * using the pool
     */
    public async discoverPoolConnectedClients() {
        if (!this.redisPool) {
            return;
        }
        log.info(`Discovering connected pool clients`);

        // XXX: This is a safe assumption *for now* but when the proxy supports multiple
        // servers this will break!
        const server = this.ircBridge.getServers()[0];
        for await (const connection of this.redisPool.getPreviouslyConnectedClients()) {
            if (connection.clientId === 'bot') {
                // The bot will be connected via the usual process.
                continue;
            }
            log.info(`Discovered ${connection.clientId}`);
            const mxUser = new MatrixUser(connection.clientId);
            if (this.getBridgedClientByUserId(server, mxUser.userId)) {
                continue;
            }

            try {
                const config = (await this.store.getIrcClientConfig(mxUser.userId, server.domain)) ||
                    IrcClientConfig.newConfig(
                        mxUser, server.domain
                    );
                const bridgeClient = await this.createIrcClient(config, mxUser, false, false);
                bridgeClient.connect().then(() => {
                    log.info(`Connected previously connected user ${connection.clientId}`);
                }).catch((ex) => {
                    log.warn(`Failed to connect previously connected user ${connection.clientId}`, ex);
                });
            }
            catch (ex) {
                log.warn(`Failed to connect ${connection.clientId}, who is connected through the proxy`, ex);
            }
        }
    }

    public async loginToServer(server: IrcServer): Promise<BridgedClient> {
        let bridgedClient = this.getBot(server);
        if (!bridgedClient) {
            const botIrcConfig = server.createBotIrcClientConfig();
            bridgedClient = this.createIrcClient(botIrcConfig, null, true);
            log.debug(
                "Created new bot client for %s : %s (bot enabled=%s)",
                server.domain, bridgedClient.id, server.isBotEnabled()
            );
        }
        let chansToJoin: string[] = [];
        if (server.isBotEnabled()) {
            if (server.shouldJoinChannelsIfNoUsers()) {
                chansToJoin = await this.store.getTrackedChannelsForServer(server.domain);
            }
            else {
                chansToJoin = await this.ircBridge.getMemberListSyncer(server).getChannelsToJoin();
            }
        }
        log.info("Bot connecting to %s (%s channels) => %s",
            server.domain, chansToJoin.length, JSON.stringify(chansToJoin)
        );
        try {
            await bridgedClient.connect();
        }
        catch (err) {
            if (err instanceof IRCConnectionError && err.code === IRCConnectionErrorCode.Banned) {
                throw Error('Bridge bot client is banned, cannot start');
            }
            log.error("Bot failed to connect to %s : %s - Retrying....", server.domain, err);
            // Wait a sensible amount of time before proceeding.
            await new Promise(r => setTimeout(r, BOT_CONNECTION_RETRY_TIME_MS));
            return this.loginToServer(server);
        }
        this.setBot(server, bridgedClient);
        let num = 1;
        chansToJoin.forEach((c: string) => {
            // join a channel every 500ms. We stagger them like this to
            // avoid thundering herds
            setTimeout(() => {
                if (!bridgedClient) { // For types.
                    return;
                }
                // catch this as if this rejects it will hard-crash
                // since this is a new stack frame which will bubble
                // up as an uncaught exception.
                bridgedClient.joinChannel(c).catch((e) => {
                    log.error("Failed to join channel:: %s", c);
                    log.error(e);
                });
            }, 500 * num);
            num += 1;
        });
        return bridgedClient;
    }

    /**
     * Get a {@link BridgedClient} instance. This will either return a cached instance
     * for the user, or create a new one.
     * @param server The IRC server for the IRC client.
     * @param userId The user_id associated with the connection.
     * @param displayName Displayname to set on the client.
     */
    public async getBridgedClient(server: IrcServer, userId: string, displayName?: string) {
        let bridgedClient = this.getBridgedClientByUserId(server, userId);
        if (bridgedClient) {
            log.debug("Returning cached bridged client %s", userId);
            return bridgedClient;
        }

        if (await this.ircBridge.getStore().isUserDeactivated(userId)) {
            throw Error("Cannot create bridged client - user has been deactivated");
        }

        const mxUser = new MatrixUser(userId);
        if (displayName) {
            mxUser.setDisplayName(displayName);
        }

        // check the database for stored config information for this irc client
        // including username, custom nick, nickserv password, etc.
        let ircClientConfig: IrcClientConfig;
        const storedConfig = await this.store.getIrcClientConfig(userId, server.domain);
        if (storedConfig) {
            log.debug("Configuring IRC user from store => " + storedConfig);
            ircClientConfig = storedConfig;
        }
        else {
            ircClientConfig = IrcClientConfig.newConfig(
                mxUser, server.domain
            );
        }

        // recheck the cache: We just await'ed to check the client config. We may
        // be racing with another request to getBridgedClient.
        bridgedClient = this.getBridgedClientByUserId(server, userId);
        if (bridgedClient) {
            log.debug("Returning cached bridged client %s", userId);
            return bridgedClient;
        }

        log.info(
            "Creating virtual irc user with nick %s for %s (display name %s)",
            ircClientConfig.getDesiredNick(), userId, displayName
        );
        try {
            bridgedClient = this.createIrcClient(ircClientConfig, mxUser, false);
            await bridgedClient.connect();
            if (!storedConfig) {
                await this.store.storeIrcClientConfig(ircClientConfig);
            }
            return bridgedClient;
        }
        catch (err) {
            if (bridgedClient) {
                // Remove client if we failed to connect!
                this.removeBridgedClient(bridgedClient);
            }
            if (err instanceof IRCConnectionError && err.code === IRCConnectionErrorCode.Banned) {
                void this.ircBridge.matrixBanSyncer?.markUserAsBanned(server.domain, userId).catch((mbsErr: Error) => {
                    log.error(`Failed to mark ${userId} as banned: ${mbsErr.toString}`);
                });
            }
            // If we failed to connect
            log.error("Couldn't connect virtual user %s (%s) to %s : %s",
                ircClientConfig.getDesiredNick(), userId, server.domain, JSON.stringify(err));
            throw err;
        }
    }

    private createBridgedClient(
        ircClientConfig: IrcClientConfig, matrixUser: MatrixUser|null, isBot: boolean, checkConditions = true
    ) {
        const server = this.ircBridge.getServer(ircClientConfig.getDomain());
        if (server === null) {
            throw Error(
                "Cannot create bridged client for unknown server " +
                ircClientConfig.getDomain()
            );
        }

        if (matrixUser && checkConditions) { // Don't bother with the bot user
            const excluded = server.isExcludedUser(matrixUser.userId);
            if (excluded) {
                throw Error("Cannot create bridged client - user is excluded from bridging");
            }
            const banReason = this.ircBridge.matrixBanSyncer?.isUserBanned(matrixUser);
            if (typeof banReason === "string") {
                throw Error(`Cannot create bridged client - user is banned (${banReason})`);
            }
        }

        if (!this.identGenerator) {
            throw Error("No ident generator configured");
        }

        if (!this.ipv6Generator) {
            throw Error("No ipv6 generator configured");
        }

        return new BridgedClient(
            server, ircClientConfig, matrixUser || undefined, isBot,
            this.ircEventBroker, this.identGenerator, this.ipv6Generator,
            this.redisPool, this.ircBridge.config.ircService.encodingFallback,
        );
    }

    private createIrcClient(
        ircClientConfig: IrcClientConfig, matrixUser: MatrixUser|null, isBot: boolean, checkConditions = true
    ) {
        const bridgedClient = this.createBridgedClient(
            ircClientConfig, matrixUser, isBot, checkConditions
        );
        const server = bridgedClient.server;

        if (this.virtualClients[server.domain] === undefined) {
            this.virtualClients[server.domain] = {
                nicks: new QuickLRU({maxSize: NICK_CACHE_SIZE}),
                userIds: new Map(),
                pending: new Map(),
            };
        }
        if (isBot) {
            this.botClients.set(server.domain, bridgedClient);
        }

        // `pending` is used to ensure that we know if a nick belongs to a userId
        // before they have been connected. It's impossible to know for sure
        // what nick they will be assigned before being connected, but this
        // should catch most cases. Knowing the nick is important, because
        // slow clients may not send a 'client-connected' signal before a join is
        // emitted, which means ghost users may join with their nickname into matrix.
        this.virtualClients[server.domain].pending.set(bridgedClient.nick, bridgedClient);

        // add event listeners
        bridgedClient.on("client-connected", this.onClientConnected.bind(this));
        bridgedClient.on("client-disconnected", this.onClientDisconnected.bind(this));
        bridgedClient.on("nick-change", this.onNickChange.bind(this));
        bridgedClient.on("join-error", this.onJoinError.bind(this));
        bridgedClient.on("irc-names", this.onNames.bind(this));

        // If the client is in the middle of changing nick, we might see IRC messages
        // come in that reference the new nick. In order to avoid duplicates, add a "pending"
        // nick in the bucket tempoarily.
        bridgedClient.on("pending-nick.add", (pendingNick) => {
            log.debug(`Added pending nick: ${pendingNick}`);
            this.virtualClients[server.domain].pending.set(pendingNick, bridgedClient);
        });
        bridgedClient.on("pending-nick.remove", (pendingNick) => {
            this.virtualClients[server.domain].pending.delete(pendingNick);
        });

        // store the bridged client immediately in the pool even though it isn't
        // connected yet, else we could spawn 2 clients for a single user if this
        // function is called quickly.
        this.virtualClients[server.domain].userIds.set(bridgedClient.userId as string, bridgedClient);

        // Does this server have a max clients limit? If so, check if the limit is
        // reached and start cycling based on oldest time.
        this.checkClientLimit(server).catch((ex) => {
            // This will be run asyncronously
            log.error("Failed to check limits: ", ex);
        });
        return bridgedClient;
    }

    public getBridgedClientByUserId(server: IrcServer, userId: string) {
        if (!this.virtualClients[server.domain]) {
            return undefined;
        }
        const cli = this.virtualClients[server.domain].userIds.get(userId);
        if (!cli || cli.isDead()) {
            return undefined;
        }
        return cli;
    }

    public getBridgedClientByNick(server: IrcServer, nick: string, allowDead = false) {
        const bot = this.getBot(server);
        if (bot && bot.nick === nick) {
            return bot;
        }

        const serverSet = this.virtualClients[server.domain];

        if (!serverSet) {
            return undefined;
        }

        let cli = serverSet.nicks.get(nick);
        if (!cli) {
            cli = [...serverSet.userIds.values()].find(c => c.nick === nick);
            if (!cli) {
                return undefined;
            }
            serverSet.nicks.set(cli.nick, cli);
        }

        if (!allowDead && cli.isDead()) {
            return undefined;
        }
        return cli;
    }

    public getBridgedClientsForUserId(userId: string): BridgedClient[] {
        const domainList = Object.keys(this.virtualClients);
        const clientList: BridgedClient[] = [];
        domainList.forEach((domain) => {
            const cli = this.virtualClients[domain].userIds.get(userId);
            if (cli && !cli.isDead()) {
                clientList.push(cli);
            }
        });
        return clientList;
    }

    public getBridgedClientsForRegex(userIdRegexString: string) {
        const userIdRegex = new RegExp(userIdRegexString);
        const domainList = Object.keys(this.virtualClients);
        const clientList: {[userId: string]: BridgedClient[]} = {};
        for (const domain of domainList) {
            for (const [userId] of this.virtualClients[domain].userIds) {
                if (!userIdRegex.test(userId)) {
                    continue;
                }
                if (!clientList[userId]) {
                    clientList[userId] = [];
                }
                const client = this.virtualClients[domain].userIds.get(userId);
                if (client) {
                    clientList[userId].push(client);
                }
            }
        }
        return clientList;
    }


    private async checkClientLimit(server: IrcServer): Promise<void> {
        if (server.getMaxClients() === 0) {
            return;
        }

        const numConnections = this.getNumberOfConnections(server);

        if (numConnections < server.getMaxClients()) {
            // under the limit, we're good for now.
            log.debug(
                "%s active connections on %s",
                numConnections, server.domain
            );
            return;
        }

        log.debug(
            "%s active connections on %s (limit %s)",
            numConnections, server.domain, server.getMaxClients()
        );

        // find the oldest client to kill.
        let oldest: BridgedClient|null = null;
        for (const [, client] of this.virtualClients[server.domain].userIds) {
            if (!client) {
                // possible since undefined/null values can be present from culled entries
                continue;
            }
            if (client.isBot) {
                continue; // don't ever kick the bot off.
            }
            if (client.status !== BridgedClientStatus.CONNECTED) {
                continue; // Don't kick clients that aren't connected.
            }
            if (oldest === null) {
                oldest = client;
                continue;
            }
            if (client.getLastActionTs() < oldest.getLastActionTs()) {
                oldest = client;
            }
        }
        if (!oldest) {
            return;
        }
        // disconnect and remove mappings.
        this.removeBridgedClient(oldest);
        const domain = oldest.server.domain;
        try {
            await oldest.disconnect("limit_reached", `Client limit exceeded: ${server.getMaxClients()}`)
            log.info(`Client limit exceeded: Disconnected ${oldest.nick} on ${domain}.`);
        }
        catch (ex) {
            log.error(`Error when disconnecting ${oldest.nick} on server ${domain}: ${JSON.stringify(ex)}`);
        }
    }

    public countTotalConnections(): number {
        let count = 0;

        for (const domain of Object.keys(this.virtualClients)) {
            const server = this.ircBridge.getServer(domain);
            if (server) {
                count += this.getNumberOfConnections(server);
            }
        }

        return count;
    }

    public totalReconnectsWaiting (serverDomain: string): number {
        return this.reconnectQueues[serverDomain]?.waitingItems ?? 0;
    }

    public updateActiveConnectionMetrics(serverDomain: string, ageCounter: AgeCounters): void {
        if (this.virtualClients[serverDomain] === undefined) {
            return;
        }
        const clients = Object.values(this.virtualClients[serverDomain].userIds);
        for (const bridgedClient of clients) {
            if (!bridgedClient || bridgedClient.isDead()) {
                // We don't want to include dead ones, or ones that don't exist.
                continue;
            }
            ageCounter.bump((Date.now() - bridgedClient.getLastActionTs()) / 1000);
        }
    }

    public getNickUserIdMappingForChannel(server: IrcServer, channel: string): Map<string, string> {
        const nickUserIdMap = new Map<string, string>();
        for (const [userId, client] of this.virtualClients[server.domain].userIds) {
            if (client.inChannel(channel)) {
                nickUserIdMap.set(client.nick, userId);
            }
        }
        // Correctly map the bot too.
        nickUserIdMap.set(server.getBotNickname(), this.ircBridge.appServiceUserId);
        return nickUserIdMap;
    }

    public getConnectedMatrixUsersForServer(server: IrcServer): (string|null)[] {
        const users = this.virtualClients[server.domain];
        if (!users) {
            throw Error("Cannot get users for unknown server");
        }
        return [...users.userIds.keys()];
    }

    public collectConnectionStatesForAllServers(
        allClients: Gauge<string>, clientsByHomeserver: Gauge<string>, clientsByHomeserverMax: number
    ) {
        allClients.reset();
        const homeserverStats: {[homeserver: string]: {[state: string]: number}} = { };
        for (const [domain, {userIds}] of Object.entries(this.virtualClients)) {
            for (const [, client] of userIds) {
                const state = BridgedClientStatus[client.status].toLowerCase();
                allClients.inc({ server: domain, state });
                if (client.matrixUser) {
                    const key = client.matrixUser.host;
                    if (!homeserverStats[key]) {
                        homeserverStats[key] = {
                            connected: 0,
                        }
                    }
                    homeserverStats[key][state] = (homeserverStats[key][state] || 0) + 1;
                }
            }
        }
        clientsByHomeserver.reset();
        // We intentionally limit the number of clients to reduce label bloat.
        Object.entries(homeserverStats)
            .sort(((a, b) => b[1]["connected"] - a[1]["connnected"]))
            .slice(0, clientsByHomeserverMax-1).forEach(
                ([homeserver, stateSet]) => {
                    Object.entries(stateSet).forEach(([state, count]) => {
                        clientsByHomeserver.set({ homeserver, state }, count);
                    });
                }
            );
    }

    /**
     * Kill any clients for users matching a ban rule on a Matrix ban list.
     */
    public async checkForBannedConnectedUsers() {
        for (const set of Object.values(this.virtualClients)) {
            for (const [userId, client] of set.userIds.entries()) {
                try {
                    const banReason = this.ircBridge.matrixBanSyncer?.isUserBanned(userId);
                    if (typeof banReason === "string") {
                        log.warn(`Killing ${userId} client connection due - user is banned (${banReason})`);
                        await client.kill('User was banned');
                    }
                }
                catch (ex) {
                    log.warn(`Failed to kill connection for ${userId}`);
                }
            }
        }
    }

    private getNumberOfConnections(server?: IrcServer): number {
        if (!server || !this.virtualClients[server.domain]) { return 0; }
        return this.virtualClients[server.domain].userIds.size;
    }

    private removeBridgedClient(bridgedClient: BridgedClient): void {
        const server = bridgedClient.server;
        if (bridgedClient.userId) {
            this.virtualClients[server.domain].userIds.delete(bridgedClient.userId);
        }
        this.virtualClients[server.domain].nicks.delete(bridgedClient.nick);

        if (bridgedClient.isBot) {
            this.botClients.delete(server.domain);
        }
    }

    private onClientConnected(bridgedClient: BridgedClient, duration: number): void {
        const server = bridgedClient.server;
        const oldNick = bridgedClient.nick;
        if (bridgedClient.status !== BridgedClientStatus.CONNECTED) {
            return;
        }
        const actualNick = bridgedClient.getClientInternalNick();

        // remove the pending nick we had set for this user
        this.virtualClients[server.domain].pending.delete(oldNick);

        // assign a nick to this client
        this.virtualClients[server.domain].nicks.set(actualNick, bridgedClient);

        // informative logging
        if (oldNick !== actualNick) {
            log.debug("Connected with nick '%s' instead of desired nick '%s'",
                actualNick, oldNick);
        }
        this.ircBridge.logTime('irc_connection_time_ms', duration);
    }

    private async onClientDisconnected(bridgedClient: BridgedClient) {
        this.removeBridgedClient(bridgedClient);

        const { userId, disconnectReason } = bridgedClient;

        log.warn(`Client ${bridgedClient.id} (${userId}) disconnected with reason ${disconnectReason}`);

        // remove the pending nick we had set for this user
        if (this.virtualClients[bridgedClient.server.domain]) {
            this.virtualClients[bridgedClient.server.domain].pending.delete(bridgedClient.nick);
        }

        if (disconnectReason === "banned" && userId) {
            void this.ircBridge.matrixBanSyncer?.markUserAsBanned(
                bridgedClient.server.domain,
                userId,
            ).catch((err: Error) => {
                log.error(`Failed to mark ${userId} as banned: ${err.toString}`);
            });
            const req = new BridgeRequest(this.ircBridge.getAppServiceBridge().getRequestFactory().newRequest());
            this.ircBridge.matrixHandler.quitUser(
                req, userId, [bridgedClient],
                null, "User was banned from the network"
            );
        }

        const isBot = bridgedClient.isBot;
        const chanList = bridgedClient.chanList;

        if (chanList.size === 0 && !isBot && disconnectReason !== "iwanttoreconnect") {
            // Never drop the bot, or users that really want to reconnect.
            log.info(
                `Dropping ${bridgedClient.id} (${bridgedClient.nick}) because they are not joined to any channels`
            );
            (bridgedClient as unknown) = undefined;
            return;
        }

        if (bridgedClient.explicitDisconnect) {
            log.info(`Dropping ${bridgedClient.id} (${bridgedClient.nick}) because explicitDisconnect is true`);
            // don't reconnect users which explicitly disconnected e.g. client
            // cycling, idle timeouts, leaving rooms, etc.
            // remove ref to the disconnected client so it can be GC'd. If we don't do this,
            // the timeout below holds it in a closure, preventing it from being GC'd.
            (bridgedClient as unknown) = undefined;
            return;
        }
        // Reconnect this user
        // change the client config to use the current nick rather than the desired nick. This
        // makes sure that the client attempts to reconnect with the *SAME* nick, and also draws
        // from the latest !nick change, as the client config here may be very very old.
        let cliConfig = bridgedClient.getClientConfig();
        if (userId) {
            // We may have changed something between connections, so use the new config.
            const newConfig = await this.store.getIrcClientConfig(userId, bridgedClient.server.domain);
            if (newConfig) {
                cliConfig = newConfig;
            }
        }

        cliConfig.setDesiredNick(bridgedClient.nick);
        const cli = this.createIrcClient(
            cliConfig, bridgedClient.matrixUser || null, bridgedClient.isBot
        );
        // remove ref to the disconnected client so it can be GC'd. If we don't do this,
        // the timeout below holds it in a closure, preventing it from being GC'd.
        (bridgedClient as unknown) = undefined;

        const queue = this.getOrCreateReconnectQueue(cli.server);
        if (queue === null) {
            this.reconnectClient({
                cli: cli,
                chanList: [...chanList],
            });
            return;
        }
        queue.enqueue(cli.id, {
            cli: cli,
            chanList: [...chanList],
        });
    }

    private async reconnectClient(cliChan: ReconnectionItem) {
        try {
            await cliChan.cli.reconnect(cliChan.chanList);
        }
        catch (ex) {
            log.error(
                "Failed to reconnect %s@%s", cliChan.cli.nick, cliChan.cli.server.domain
            );
        }
    }

    private onNickChange(bridgedClient: BridgedClient, oldNick: string, newNick: string): void {
        log.info(`Remapped ${bridgedClient.userId} from ${oldNick} to ${newNick}`);
        this.virtualClients[bridgedClient.server.domain].nicks.delete(oldNick);
        this.virtualClients[bridgedClient.server.domain].nicks.set(newNick, bridgedClient);
        this.virtualClients[bridgedClient.server.domain].pending.delete(newNick);
    }

    private async onJoinError (bridgedClient: BridgedClient, chan: string, err: string): Promise<void> {
        const errorsThatShouldKick = [
            "err_bannedfromchan", // they aren't allowed in channels they are banned on.
            "err_inviteonlychan", // they aren't allowed in invite only channels
            "err_channelisfull", // they aren't allowed in if the channel is full
            "err_badchannelkey", // they aren't allowed in channels with a bad key
            "err_needreggednick", // they aren't allowed in +r channels if they haven't authed
        ];
        if (!errorsThatShouldKick.includes(err)) {
            return;
        }
        const userId = bridgedClient.userId;
        if (!userId || bridgedClient.isBot) {
            return; // the bot itself can get these join errors
        }
        if (!bridgedClient.server.config.ircClients.kickOn.channelJoinFailure) {
            return; // The bridge is configured not to kick on failure.
        }
        // TODO: this is a bit evil, no one in their right mind would expect
        // the client pool to be kicking matrix users from a room :(
        log.info(`Kicking ${userId} from room due to ${err}`);
        const matrixRooms = await this.ircBridge.getStore().getMatrixRoomsForChannel(
            bridgedClient.server, chan
        );
        const promises = matrixRooms.map((room: MatrixRoom) => {
            return this.ircBridge.getAppServiceBridge().getIntent().kick(
                room.getId(), userId, `IRC error on ${chan}: ${err}`
            );
        });
        await Promise.all(promises);
    }

    private onNames(bridgedClient: BridgedClient, chan: string, names: Map<string, string>): void {
        const mls = this.ircBridge.getMemberListSyncer(bridgedClient.server);
        if (!mls) {
            return;
        }
        mls.updateIrcMemberList(chan, names).catch(ex => {
            bridgedClient.log.error(`Failed to handle NAMES for ${chan} %s`, ex);
        });
    }
}
