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

import { Client, ClientEvents, IrcClientOpts, Message } from "matrix-org-irc";
import * as promiseutil from "../promiseutil";
import Scheduler from "./Scheduler";
import * as logging from "../logging";
import { Defer } from "../promiseutil";
import { IrcServer } from "./IrcServer";
import { getBridgeVersion } from "matrix-appservice-bridge";
import { IrcPoolClient } from "../pool-service/IrcPoolClient";
import { RedisIrcConnection } from "../pool-service/RedisIrcConnection";

const log = logging.get("client-connection");

/**
 * The time we're willing to wait for a connect callback when connecting to IRC.
 *
 * This is also the time we will wait before assuming a disconnect has gone through.
 */
const CONNECT_TIMEOUT_MS = 30 * 1000; // 30s
// The delay between messages when there are >1 messages to send.
const FLOOD_PROTECTION_DELAY_MS = 700;
// The max amount of time we should wait for the server to ping us before reconnecting.
// Servers ping infrequently (2-3mins) so this should be high enough to allow up
// to 2 pings to lapse before reconnecting (5-6mins).

const THROTTLE_WAIT_MS = 20 * 1000;

// String reply of any CTCP Version requests
const CTCP_VERSION =
    (homeserverName: string) => `matrix-appservice-irc ${getBridgeVersion()} bridged via ${homeserverName}`;

const CONN_LIMIT_MESSAGES = [
    "too many host connections", // ircd-seven
    "no more connections allowed in your connection class",
    "this server is full", // unrealircd
];

// Log an Error object to stderr
function logError(err: Error) {
    if (!err || !err.message) {
        return;
    }
    log.error(err.message);
}

export interface ConnectionOpts {
    localAddress?: string;
    password?: string;
    realname: string;
    username?: string;
    nick: string;
    secure?: {
        ca?: string;
    };
    encodingFallback?: string;
    useRedisPool?: IrcPoolClient,
}

export type InstanceDisconnectReason = "throttled"|"irc_error"|"net_error"|"timeout"|"raw_error"|
                                       "toomanyconns"|"banned"|"killed"|"idle"|"limit_reached"|
                                       "iwanttoreconnect";


export enum IRCConnectionErrorCode {
    Unknown = 0,
    Banned = 1,
    ILine = 2,
}

export class IRCConnectionError extends Error {
    constructor(public readonly code: IRCConnectionErrorCode, message: string) {
        super(message);
    }
}

export class ConnectionInstance {
    public dead = false;
    private state: "created"|"connecting"|"connected" = "created";
    private pingRateTimerId: NodeJS.Timeout|null = null;
    private clientSidePingTimeoutTimerId: NodeJS.Timeout|null = null;
    // eslint-disable-next-line no-use-before-define
    private connectDefer: Defer<ConnectionInstance>;
    public onDisconnect?: (reason: string) => void;

    /**
     * Create an IRC connection instance. Wraps the matrix-org-irc library to handle
     * connections correctly.
     * @constructor
     * @param client The new IRC client.
     * @param domain The domain (for logging purposes)
     * @param nick The nick (for logging purposes)
     * @param pingOpts Options for automatic pings to the IRCd.
     * @param homeserverDomain The homeserver's domain, for the CTCP version string.
     */
    constructor (public readonly client: Client, private readonly domain: string, private nick: string,
        private pingOpts: {
        pingRateMs: number;
        pingTimeoutMs: number;
    }, private readonly homeserverDomain: string, private readonly redisConn?: RedisIrcConnection) {
        this.listenForErrors();
        this.listenForPings();
        this.listenForCTCPVersions();
        this.connectDefer = promiseutil.defer();
    }

    /**
     * Connect this client to the server. There are zero guarantees this will ever
     * connect.
     * @return {Promise} Resolves if connected; rejects if failed to connect.
     */
    public connect(): Promise<ConnectionInstance> {
        if (this.dead) {
            throw new Error("connect() called on dead client: " + this.nick);
        }
        this.state = "connecting";
        let gotConnectedCallback = false;
        setTimeout(() => {
            if (!gotConnectedCallback && !this.dead) {
                log.error(
                    "%s@%s still not connected after %sms. Killing connection.",
                    this.nick, this.domain, CONNECT_TIMEOUT_MS
                );
                this.disconnect("timeout").catch(logError);
            }
        }, CONNECT_TIMEOUT_MS);

        this.client.connect(1, () => {
            gotConnectedCallback = true;
            this.state = "connected";
            this.resetPingSendTimer();
            this.connectDefer.resolve(this);
        });
        return this.connectDefer.promise;
    }

    /**
     * Blow away the connection. You MUST destroy this object afterwards.
     * @param {string} reason - Reason to reject with. One of:
     * throttled|irc_error|net_error|timeout|raw_error|toomanyconns|banned
     */
    public async disconnect(reason: InstanceDisconnectReason, ircReason?: string): Promise<void> {
        if (this.dead) {
            return;
        }
        ircReason = ircReason || reason;
        log.info(
            "disconnect()ing %s@%s - %s", this.nick, this.domain, reason
        );
        this.dead = true;

        // It's imperative we wait for the disconnect, as the IrcConnectionPool
        // doesn't allow us to create new connections for a given user
        // while a previous one is active.
        // close the connection
        await new Promise<void>((resolveDc) => {
            // Forcibly ignore the DC if it takes any longer.
            const timeout = setTimeout(() => {
                log.warn(`Waited for 'end' that never came`);
                resolveDc();
            }, CONNECT_TIMEOUT_MS);
            this.client.disconnect(ircReason, () => {
                log.debug("Server responded to our disconnect");
                clearTimeout(timeout);
                resolveDc();
            });
        });

        // remove timers
        if (this.pingRateTimerId) {
            clearTimeout(this.pingRateTimerId);
            this.pingRateTimerId = null;
        }
        if (this.clientSidePingTimeoutTimerId) {
            clearTimeout(this.clientSidePingTimeoutTimerId);
            this.clientSidePingTimeoutTimerId = null;
        }
        if (this.state !== "connected") {
            // we never resolved this defer, so reject it.
            this.connectDefer.reject(new Error(reason));
        }
        if (this.state === "connected" && this.onDisconnect) {
            // we only invoke onDisconnect once we've had a successful connect.
            // Connection *attempts* are managed by the create() function so if we
            // call this now it would potentially invoke this 3 times (once per
            // connection instance!). Each time would have dead=false as they are
            // separate objects.
            this.onDisconnect(reason);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public addListener<T extends keyof ClientEvents>(eventName: T, fn: ClientEvents[T]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.client.addListener(eventName, (...args: any[]) => {
            if (this.dead) {
                log.error(
                    "%s@%s RECV a %s event for a dead connection",
                    this.nick, this.domain, eventName
                );
                return;
            }
            // This is fine, we're checking the types above and passing them through
            // TypeScript doesn't handle us passing in typed arguments to an apply
            // function all that well.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const typelessFn = fn as (...params: any[]) => void;
            // do the callback
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            typelessFn.apply(fn, args as any);
        });
    }

    private listenForErrors() {
        this.client.addListener("error", (err?: Message) => {
            // We should disconnect the client for some but not all error codes. This
            // list is a list of codes which we will NOT disconnect the client for.
            const failCodes = [
                "err_nosuchchannel", "err_toomanychannels", "err_channelisfull",
                "err_inviteonlychan", "err_bannedfromchan", "err_badchannelkey",
                "err_needreggednick", "err_nosuchnick", "err_cannotsendtochan",
                "err_toomanychannels", "err_erroneusnickname", "err_usernotinchannel",
                "err_notonchannel", "err_useronchannel", "err_notregistered",
                "err_alreadyregistred", "err_noprivileges", "err_chanoprivsneeded",
                "err_banonchan", "err_nickcollision", "err_nicknameinuse",
                "err_erroneusnickname", "err_nonicknamegiven", "err_eventnickchange",
                "err_nicktoofast", "err_unknowncommand", "err_unavailresource",
                "err_umodeunknownflag", "err_nononreg",
                "err_nooperhost", "err_passwdmismatch",
            ];
            if (err && err.command) {
                if (failCodes.includes(err.command)) {
                    // Don't log these so loudly
                    log.info("Server: %s (%s) %s", this.domain, this.nick, JSON.stringify(err));
                    return; // don't disconnect for these error codes.
                }
            }
            log.error("Server: %s (%s) Error: %s", this.domain, this.nick, JSON.stringify(err));
            if (err && err.command === "err_yourebannedcreep") {
                this.disconnect("banned").catch(logError);
                return;
            }
            this.disconnect("irc_error").catch(logError);
        });
        this.client.addListener("netError", (err) => {
            log.error(
                "Server: %s (%s) Network Error: %s", this.domain, this.nick,
                err instanceof Error ? err.message : JSON.stringify(err, undefined, 2)
            );
            this.disconnect("net_error").catch(logError);
        });
        this.client.addListener("abort", () => {
            log.error(
                "Server: %s (%s) Connection Aborted", this.domain, this.nick
            );
            this.disconnect("net_error").catch(logError);
        });
        this.client.addListener("raw", (msg?: Message) => {
            if (logging.isVerbose()) {
                log.debug(
                    "%s@%s: %s", this.nick, this.domain, JSON.stringify(msg)
                );
            }
            if (msg && (msg.command === "ERROR" || msg.rawCommand === "ERROR")) {
                log.error(
                    "%s@%s: %s", this.nick, this.domain, JSON.stringify(msg)
                );
                let wasThrottled = false;
                if (!msg.args) {
                    this.disconnect("raw_error").catch(logError);
                    return;
                }

                // E.g. 'Closing Link: gateway/shell/matrix.org/session (Bad user info)'
                // ircd-seven doc link: https://git.io/JvxEs
                if (msg.args[0]?.match(/Closing Link: .+\(Bad user info\)/)) {
                    log.error(
                        `User ${this.nick} was X:LINED!`
                    );
                    this.disconnect("banned").catch(logError);
                    return;
                }

                let errText = ("" + msg.args[0]) || "";
                errText = errText.toLowerCase();
                wasThrottled = errText.includes("throttl");

                if (wasThrottled) {
                    this.disconnect("throttled").catch(logError);
                    return;
                }

                const wasBanned = errText.includes("banned") || errText.includes("k-lined");

                if (wasBanned) {
                    this.disconnect("banned").catch(logError);
                    return;
                }

                const tooManyHosts = CONN_LIMIT_MESSAGES.find((connLimitMsg) => {
                    return errText.includes(connLimitMsg);
                }) !== undefined;

                if (tooManyHosts) {
                    this.disconnect("toomanyconns").catch(logError);
                    return;
                }

                this.disconnect("raw_error").catch(logError);
            }
        });
    }

    private listenForPings() {
        // BOTS-65 : A client can get ping timed out and not reconnect.
        // ------------------------------------------------------------
        // The client is doing IRC ping/pongs, but there is no check to say
        // "hey, the server hasn't pinged me in a while, it's probably dead". The
        // RFC for pings states that pings are sent "if no other activity detected
        // from a connection." so we need to count anything we shove down the wire
        // as a ping refresh.
        const keepAlivePing = () => { // refresh the ping timer
            if (this.clientSidePingTimeoutTimerId) {
                clearTimeout(this.clientSidePingTimeoutTimerId);
            }
            this.clientSidePingTimeoutTimerId = setTimeout(() => {
                log.info(
                    "Ping timeout: knifing connection for %s on %s",
                    this.domain, this.nick,
                );
                // Just emit an netError which clients need to handle anyway.
                this.client.emit("netError", new Error(`Client-side ping timeout`));
            }, this.pingOpts.pingTimeoutMs);
        }
        this.client.on("ping", (svr: string) => {
            log.debug("Received ping from %s directed at %s", svr, this.nick);
            keepAlivePing();
        });
        // decorate client.send to refresh the timer
        const realSend = this.client.send;
        this.client.send = (...args: string[]) => {
            keepAlivePing();
            this.resetPingSendTimer(); // sending a message counts as a ping
            return realSend.apply(this.client, args);
        };
    }

    private listenForCTCPVersions() {
        this.client.addListener("ctcp-version", (from: string) => {
            if (from) { // Ensure the sender is valid before we try to respond
                this.client.ctcp(from, 'reply', `VERSION ${CTCP_VERSION(this.homeserverDomain)}`);
            }
        });
    }

    private resetPingSendTimer() {
        // reset the ping rate timer
        if (this.pingRateTimerId) {
            clearTimeout(this.pingRateTimerId);
        }
        this.pingRateTimerId = setTimeout(() => {
            if (this.dead) {
                return;
            }
            // Do what XChat does
            this.client.send("PING", "LAG" + Date.now());
            // keep doing it.
            this.resetPingSendTimer();
        }, this.pingOpts.pingRateMs);
    }

    /**
     * Create an IRC client connection and connect to it.
     * @param {IrcServer} server The server to connect to.
     * @param {Object} opts Options for this connection.
     * @param {string} opts.nick The nick to use.
     * @param {string} opts.username The username to use.
     * @param {string} opts.realname The real name of the user.
     * @param {string} opts.password The password to give NickServ.
     * @param {string} opts.localAddress The local address to bind to when connecting.
     * @param {string} homeserverDomain Domain of the homeserver bridging requests.
     * @param {Function} onCreatedCallback Called with the client when created.
     * @return {Promise} Resolves to an ConnectionInstance or rejects.
     */
    public static async create (server: IrcServer,
                                opts: ConnectionOpts,
                                homeserverDomain: string,
                                ident: string,
                                onCreatedCallback?: (inst: ConnectionInstance) => void): Promise<ConnectionInstance> {
        if (!opts.nick || !server) {
            throw new Error("Bad inputs. Nick: " + opts.nick);
        }
        const connectionOpts: IrcClientOpts = {
            userName: opts.username,
            realName: opts.realname,
            password: opts.password,
            localAddress: opts.localAddress,
            autoConnect: false,
            autoRejoin: false,
            floodProtection: true,
            floodProtectionDelay: FLOOD_PROTECTION_DELAY_MS,
            port: server.getPort(),
            selfSigned: server.useSslSelfSigned(),
            certExpired: server.allowExpiredCerts(),
            retryCount: 0,
            family: (server.getIpv6Prefix() || server.getIpv6Only() ? 6 : null) as 6|null,
            bustRfc3484: true,
            sasl: opts.password ? server.useSasl() : false,
            secure: server.useSsl() ? server.getSecureOptions() : undefined,
            encodingFallback: opts.encodingFallback,
        };


        // Returns: A promise which resolves to a ConnectionInstance
        const retryConnection = async () => {
            const domain = server.randomDomain();
            const redisConn = opts.useRedisPool && await opts.useRedisPool.createOrGetIrcSocket(ident, {
                ...connectionOpts,
                clientId: ident,
                port: connectionOpts.port ?? 6667,
                localAddress: connectionOpts.localAddress ?? undefined,
                localPort: connectionOpts.localPort ?? undefined,
                family: connectionOpts.family ?? undefined,
                host: domain,
            });

            const nodeClient = new Client(
                domain, opts.nick, connectionOpts, redisConn?.state, redisConn,
            );
            const inst = new ConnectionInstance(
                nodeClient, server.domain, opts.nick, {
                    pingRateMs: server.pingRateMs,
                    pingTimeoutMs: server.pingTimeout,
                },
                homeserverDomain,
                redisConn,
            );
            if (onCreatedCallback) {
                onCreatedCallback(inst);
            }
            if (redisConn) {
                log.debug(`Calling connect for ${redisConn?.clientId}`);
            }
            return inst.connect();
        };

        let connAttempts = 0;
        let retryTimeMs = 0;
        const BASE_RETRY_TIME_MS = 1000;
        while (true) {
            try {
                if (server.getReconnectIntervalMs() > 0) {
                    // wait until scheduled
                    return (await Scheduler.reschedule(
                        server, retryTimeMs, retryConnection, opts.nick
                    )) as ConnectionInstance;
                }
                // Try to connect immediately: we'll wait if we fail.
                return await retryConnection();
            }
            catch (err) {
                connAttempts += 1;
                log.error(
                    `ConnectionInstance.connect failed after ${connAttempts} attempts (${err.message})`
                );

                if (err.message === "throttled") {
                    retryTimeMs += THROTTLE_WAIT_MS;
                }

                if (err.message === "banned") {
                    log.error(
                        `${opts.nick} is banned from ${server.domain}, throwing`
                    );
                    throw new IRCConnectionError(IRCConnectionErrorCode.Banned, "User is banned from the network.");
                    // If the user is banned, we should part them from any rooms.
                }

                if (err.message === "toomanyconns") {
                    log.error(
                        `User ${opts.nick} was ILINED. This may be the network limiting us!`
                    );
                    throw new IRCConnectionError(
                        IRCConnectionErrorCode.ILine,
                        "Connection was ILINED. We cannot retry this."
                    );
                }

                // always set a staggered delay here to avoid thundering herd
                // problems on mass-disconnects
                const delay = (BASE_RETRY_TIME_MS * Math.random())+ retryTimeMs +
                        Math.round((connAttempts * 1000) * Math.random());
                log.info(`Retrying connection for ${opts.nick} on ${server.domain} `+
                        `in ${delay}ms (attempts ${connAttempts})`);
                await promiseutil.delay(delay);
            }
        }
    }
}
