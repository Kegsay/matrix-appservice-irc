import { AppServiceRegistration, PowerLevelContent } from "matrix-appservice-bridge";
import { BridgeConfig } from "../../src/config/BridgeConfig";
import { Client as PgClient } from "pg";
import { ComplementHomeServer, createHS, destroyHS } from "./homerunner";
import { IrcBridge } from '../../src/bridge/IrcBridge';
import { IrcServer } from "../../src/irc/IrcServer";
import { MatrixClient } from "matrix-bot-sdk";
import { TestIrcServer } from "matrix-org-irc";
import { IrcConnectionPool } from "../../src/pool-service/IrcConnectionPool";
import { expect } from "@jest/globals";
import dns from 'node:dns';
import fs from "node:fs/promises";
import { WriteStream, createWriteStream } from "node:fs";
import { DEFAULTS as MatrixHandlerDefaults } from "../../src/bridge/MatrixHandler";
// Needed to make tests work on GitHub actions. Node 17+ defaults
// to IPv6, and the homerunner domain resolves to IPv6, but the
// runtime doesn't actually support IPv6 🤦
dns.setDefaultResultOrder('ipv4first');

const WAIT_EVENT_TIMEOUT = 10000;

const DEFAULT_PORT = parseInt(process.env.IRC_TEST_PORT ?? '6667', 10);
const DEFAULT_ADDRESS = process.env.IRC_TEST_ADDRESS ?? "127.0.0.1";
const IRCBRIDGE_TEST_REDIS_URL = process.env.IRCBRIDGE_TEST_REDIS_URL;


interface Opts {
    matrixLocalparts?: string[];
    ircNicks?: string[];
    timeout?: number;
    config?: Partial<BridgeConfig>,
    traceToFile?: boolean,
    shortReplyTresholdSeconds?: number,
}

const traceFilePath = '.e2e-traces';

export class E2ETestMatrixClient extends MatrixClient {

    public async waitForPowerLevel(
        roomId: string, expected: Partial<PowerLevelContent>,
    ): Promise<{roomId: string, data: {
        sender: string, type: string, state_key?: string, content: PowerLevelContent, event_id: string,
    }}> {
        return this.waitForEvent('room.event', (eventRoomId: string, eventData: {
            sender: string, type: string, content: Record<string, unknown>, event_id: string, state_key: string,
        }) => {
            if (eventRoomId !== roomId) {
                return undefined;
            }

            if (eventData.type !== "m.room.power_levels") {
                return undefined;
            }

            if (eventData.state_key !== "") {
                return undefined;
            }

            // Check only the keys we care about
            for (const [key, value] of Object.entries(expected)) {
                const evValue = eventData.content[key] ?? undefined;
                const sortOrder = value !== null && typeof value === "object" ? Object.keys(value).sort() : undefined;
                const jsonLeft = JSON.stringify(evValue, sortOrder);
                const jsonRight = JSON.stringify(value, sortOrder);
                if (jsonLeft !== jsonRight) {
                    return undefined;
                }
            }

            console.info(
                // eslint-disable-next-line max-len
                `${eventRoomId} ${eventData.event_id} ${eventData.sender}`
            );
            return {roomId: eventRoomId, data: eventData};
        }, `Timed out waiting for powerlevel from in ${roomId}`)
    }

    public async waitForRoomEvent<T extends object = Record<string, unknown>>(
        opts: {eventType: string, sender: string, roomId?: string, stateKey?: string}
    ): Promise<{roomId: string, data: {
        sender: string, type: string, state_key?: string, content: T, event_id: string,
    }}> {
        const {eventType, sender, roomId, stateKey} = opts;
        return this.waitForEvent('room.event', (eventRoomId: string, eventData: {
            sender: string, type: string, state_key?: string, content: T, event_id: string,
        }) => {
            if (eventData.sender !== sender) {
                return undefined;
            }
            if (eventData.type !== eventType) {
                return undefined;
            }
            if (roomId && eventRoomId !== roomId) {
                return undefined;
            }
            if (stateKey !== undefined && eventData.state_key !== stateKey) {
                return undefined;
            }
            const body = 'body' in eventData.content && eventData.content.body;
            console.info(
                // eslint-disable-next-line max-len
                `${eventRoomId} ${eventData.event_id} ${eventData.type} ${eventData.sender} ${eventData.state_key ?? body ?? ''}`
            );
            return {roomId: eventRoomId, data: eventData};
        }, `Timed out waiting for ${eventType} from ${sender} in ${roomId || "any room"}`)
    }

    public async waitForRoomInvite(
        opts: {sender: string, roomId?: string}
    ): Promise<{roomId: string, data: unknown}> {
        const {sender, roomId} = opts;
        return this.waitForEvent('room.invite', (eventRoomId: string, eventData: {
            sender: string
        }) => {
            const inviteSender = eventData.sender;
            console.info(`Got invite to ${eventRoomId} from ${inviteSender}`);
            if (eventData.sender !== sender) {
                return undefined;
            }
            if (roomId && eventRoomId !== roomId) {
                return undefined;
            }
            return {roomId: eventRoomId, data: eventData};
        }, `Timed out waiting for invite to ${roomId || "any room"} from ${sender}`)
    }

    public async waitForEvent<T>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        emitterType: string, filterFn: (...args: any[]) => T|undefined, timeoutMsg: string)
    : Promise<T> {
        return new Promise((resolve, reject) => {
            // eslint-disable-next-line prefer-const
            let timer: NodeJS.Timeout;
            const fn = (...args: unknown[]) => {
                const data = filterFn(...args);
                if (data) {
                    clearTimeout(timer);
                    resolve(data);
                }
            };
            timer = setTimeout(() => {
                this.removeListener(emitterType, fn);
                reject(new Error(timeoutMsg));
            }, WAIT_EVENT_TIMEOUT);
            this.on(emitterType, fn)
        });
    }
}

export class IrcBridgeE2ETest {

    public static get usingRedis() {
        return !!IRCBRIDGE_TEST_REDIS_URL;
    }

    private static async createDatabase() {
        const pgClient = new PgClient(`${process.env.IRCBRIDGE_TEST_PGURL}/postgres`);
        try {
            await pgClient.connect();
            const postgresDb = `${process.env.IRCBRIDGE_TEST_PGDB}_${process.hrtime().join("_")}`;
            await pgClient.query(`CREATE DATABASE ${postgresDb}`);
            return postgresDb;
        }
        finally {
            await pgClient.end();
        }
    }

    static async createTestEnv(opts: Opts = {}): Promise<IrcBridgeE2ETest> {
        let traceStream;
        if (opts.traceToFile) {
            const testName = expect.getState().currentTestName?.replace(/[^a-zA-Z]/g, '-');
            const tracePath = `${traceFilePath}/${testName}.log`;
            try {
                await fs.mkdir(traceFilePath);
            }
            catch (ex) {
                if (ex.code !== 'EEXIST') {
                    throw ex;
                }
            }
            traceStream = createWriteStream(tracePath, 'utf-8');
        }

        const workerID = parseInt(process.env.JEST_WORKER_ID ?? '0');
        const { matrixLocalparts, config } = opts;
        const ircTest = new TestIrcServer();
        const [postgresDb, homeserver] = await Promise.all([
            this.createDatabase(),
            createHS(["ircbridge_bot", ...matrixLocalparts || []], workerID),
            ircTest.setUp(opts.ircNicks),
        ]);
        const redisUri = IRCBRIDGE_TEST_REDIS_URL && `${IRCBRIDGE_TEST_REDIS_URL}/${workerID}`;
        let redisPool: IrcConnectionPool|undefined;

        if (redisUri) {
            redisPool = new IrcConnectionPool({
                redisUri,
                metricsHost: false,
                metricsPort: 7002,
                loggingLevel: 'debug',
            });
        }

        const registration = AppServiceRegistration.fromObject({
            id: homeserver.id,
            as_token: homeserver.appserviceConfig.asToken,
            hs_token: homeserver.appserviceConfig.hsToken,
            sender_localpart: homeserver.appserviceConfig.senderLocalpart,
            namespaces: {
                users: [{
                    exclusive: true,
                    regex: `@irc_.+:${homeserver.domain}`,
                }],
                // TODO: No support on complement yet:
                // https://github.com/matrix-org/complement/blob/8e341d54bbb4dbbabcea25e6a13b29ead82978e3/internal/docker/builder.go#L413
                aliases: [{
                    exclusive: true,
                    regex: `#irc_.+:${homeserver.domain}`,
                }]
            },
            url: "not-used",
        });

        const ircBridge = new IrcBridge({
            homeserver: {
                domain: homeserver.domain,
                url: homeserver.url,
                bindHostname: "0.0.0.0",
                bindPort: homeserver.appserviceConfig.port,
            },
            database: {
                engine: "postgres",
                connectionString: `${process.env.IRCBRIDGE_TEST_PGURL}/${postgresDb}`,
            },
            ircService: {
                ircHandler: {
                    powerLevelGracePeriodMs: 0,
                },
                matrixHandler: {
                    ...MatrixHandlerDefaults,
                    shortReplyTresholdSeconds: opts.shortReplyTresholdSeconds ?? 0,
                },
                servers: {
                    localhost: {
                        ...IrcServer.DEFAULT_CONFIG,
                        port: DEFAULT_PORT,
                        additionalAddresses: [DEFAULT_ADDRESS],
                        onlyAdditionalAddresses: true,
                        matrixClients: {
                            userTemplate: "@irc_$NICK",
                            displayName: "$NICK",
                            joinAttempts: 3,
                        },
                        dynamicChannels: {
                            enabled: true,
                            createAlias: true,
                            published: true,
                            joinRule: "public",
                            federate: true,
                            aliasTemplate: "#irc_$SERVER_$CHANNEL",
                        },
                        membershipLists: {
                            enabled: true,
                            floodDelayMs: 100,
                            global: {
                                ircToMatrix: {
                                    incremental: true,
                                    initial: true,
                                    requireMatrixJoined: false,
                                },
                                matrixToIrc: {
                                    incremental: true,
                                    initial: true,
                                }
                            }
                        }
                    }
                },
                provisioning: {
                    enabled: false,
                    requestTimeoutSeconds: 0,
                },
                logging: {
                    level: "debug",
                    toConsole: true,
                    maxFiles: 0,
                    verbose: false,
                    timestamp: true,
                },
                ident: {
                    enabled: false,
                    address: "",
                    port: 0,
                },
                debugApi: {
                    enabled: false,
                    port: 0,
                }
            },
            ...config,
            ...(redisUri && { connectionPool: {
                persistConnectionsOnShutdown: false,
                ...config?.connectionPool || {},
                redisUrl: redisUri,
            }
            }),
        }, registration);
        return new IrcBridgeE2ETest(
            homeserver, ircBridge, registration, postgresDb, ircTest, opts, redisPool, traceStream
        );
    }

    private constructor(
        public readonly homeserver: ComplementHomeServer,
        public ircBridge: IrcBridge,
        public readonly registration: AppServiceRegistration,
        readonly postgresDb: string,
        public readonly ircTest: TestIrcServer,
        public readonly opts: Opts,
        public readonly pool?: IrcConnectionPool,
        private traceLog?: WriteStream,
    ) {
        const startTime = Date.now();
        if (traceLog) {
            for (const [clientId, client] of Object.entries(ircTest.clients)) {
                client.on('raw', (msg) => {
                    traceLog.write(
                        `${Date.now() - startTime}ms [IRC:${clientId}] ${JSON.stringify(msg)} \n`
                    );
                })
            }
            for (const {client, userId} of Object.values(homeserver.users)) {
                client.on('room.event', (roomId, eventData) => {
                    traceLog.write(
                        `${Date.now() - startTime}ms [Matrix:${userId}] ${roomId} ${JSON.stringify(eventData)}\n`
                    );
                })
            }
        }
    }

    public async recreateBridge() {
        await this.ircBridge.kill('Recreating');
        this.ircBridge = new IrcBridge(this.ircBridge.config, this.registration);
        return this.ircBridge;
    }

    private async dropDatabase() {
        if (!this.postgresDb) {
            // Database was never set up.
            return;
        }
        const pgClient = new PgClient(`${process.env.IRCBRIDGE_TEST_PGURL}/postgres`);
        await pgClient.connect();
        await pgClient.query(`DROP DATABASE ${this.postgresDb}`);
        await pgClient.end();
    }

    public async setUp(): Promise<void> {
        if (this.pool) {
            await this.pool.start();
        }
        await this.ircBridge.run(null);
    }

    public async tearDown(): Promise<void> {
        // This is specifically ordered this way so that
        // it's closed in dependency order.
        await this.ircBridge?.kill();
        await this.ircTest.tearDown();
        await this.homeserver?.users.map(c => c.client.stop());
        await (this.homeserver && destroyHS(this.homeserver.id));
        await this.pool?.close();
        await this.dropDatabase();
        if (this.traceLog) {
            this.traceLog.close();
        }
    }

    public async createAdminRoomHelper(client: E2ETestMatrixClient): Promise<string> {
        const adminRoomId = await client.createRoom({
            is_direct: true,
            invite: [this.ircBridge.appServiceUserId],
        });
        await client.waitForRoomEvent(
            {eventType: 'm.room.member', sender: this.ircBridge.appServiceUserId, roomId: adminRoomId}
        );
        return adminRoomId;
    }

    public async joinChannelHelper(client: E2ETestMatrixClient, adminRoomId: string, channel: string): Promise<string> {
        await client.sendText(adminRoomId, `!join ${channel}`);
        const invite = await client.waitForRoomInvite(
            {sender: this.ircBridge.appServiceUserId}
        );
        const cRoomId = invite.roomId;
        await client.joinRoom(cRoomId);
        return cRoomId;
    }
}
