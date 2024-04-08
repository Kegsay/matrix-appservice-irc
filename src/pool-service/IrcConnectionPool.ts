import { Redis } from 'ioredis';
import { Logger, LogLevel } from 'matrix-appservice-bridge';
import { createConnection, Socket } from 'net';
import tls from 'tls';
import { OutCommandType,
    REDIS_IRC_POOL_COMMAND_OUT_STREAM, IrcConnectionPoolCommandIn,
    ConnectionCreateArgs, InCommandType, CommandError,
    REDIS_IRC_POOL_HEARTBEAT_KEY,
    REDIS_IRC_POOL_VERSION_KEY,
    REDIS_IRC_POOL_COMMAND_IN_STREAM,
    REDIS_IRC_POOL_CONNECTIONS,
    ClientId,
    OutCommandPayload,
    IrcConnectionPoolCommandOut,
    REDIS_IRC_CLIENT_STATE_KEY,
    HEARTBEAT_EVERY_MS,
    PROTOCOL_VERSION,
    READ_BUFFER_MAGIC_BYTES
} from './types';
import { parseMessage } from 'matrix-org-irc';
import { collectDefaultMetrics, register, Gauge } from 'prom-client';
import { createServer, Server } from 'http';
import { RedisCommandReader } from './CommandReader';

collectDefaultMetrics();

const log = new Logger('IrcConnectionPool');
const TIME_TO_WAIT_BEFORE_PONG = 10000;


const Config = {
    redisUri: process.env.REDIS_URL ?? 'redis://localhost:6379',
    metricsHost: (process.env.METRICS_HOST ?? false) as string|false,
    metricsPort: parseInt(process.env.METRICS_PORT ?? '7002'),
    loggingLevel: (process.env.LOGGING_LEVEL ?? 'info') as LogLevel,
}

const connectionsGauge = new Gauge({
    help: 'The number of connections being held by the pool',
    name: 'irc_pool_connections'
});

export class IrcConnectionPool {
    private readonly cmdWriter: Redis;
    /**
     * Track all the connections expecting a pong response.
     */
    private readonly connectionPongTimeouts = new Map<ClientId, NodeJS.Timeout>();
    private readonly cmdReader: Redis;
    private readonly connections = new Map<ClientId, Socket>();

    private commandStreamId = "$";
    private metricsServer?: Server;
    private shouldRun = true;
    private heartbeatTimer?: NodeJS.Timeout;
    private readonly commandReader: RedisCommandReader;

    constructor(private readonly config: typeof Config) {
        this.shouldRun = false;
        this.cmdWriter = new Redis(config.redisUri, { lazyConnect: true });
        this.cmdReader = new Redis(config.redisUri, { lazyConnect: true });
        this.cmdWriter.on('connecting', () => {
            log.debug('Connecting to', config.redisUri);
        });
        this.commandReader = new RedisCommandReader(
            this.cmdReader, REDIS_IRC_POOL_COMMAND_IN_STREAM, this.handleStreamCommand.bind(this)
        );
    }

    private async sendCommandOut<T extends OutCommandType>(type: T, payload: OutCommandPayload[T]) {
        await this.cmdWriter.xadd(REDIS_IRC_POOL_COMMAND_OUT_STREAM, "*", type, JSON.stringify({
            info: payload,
            origin_ts: Date.now(),
        } as IrcConnectionPoolCommandOut<OutCommandType>)).catch((ex) => {
            log.warn(`Unable to send command out`, ex);
        });
        log.debug(`Sent command out ${type}`, payload);
    }

    private async createConnectionForOpts(opts: ConnectionCreateArgs): Promise<Socket> {
        if (opts.secure) {
            let secureOpts: tls.ConnectionOptions = {
                ...opts,
                rejectUnauthorized: !(opts.selfSigned || opts.certExpired),
            }

            if (typeof opts.secure === 'object') {
                // copy "secure" opts to options passed to connect()
                secureOpts = {
                    ...secureOpts,
                    ...opts.secure,
                };
            }

            return await new Promise((resolve, reject) => {
                // Taken from https://github.com/matrix-org/node-irc/blob/0764733af7c324ee24f8c2a3c26fe9d1614be344/src/irc.ts#L1231
                const sock = tls.connect(secureOpts, () => {
                    if (sock.authorized) {
                        resolve(sock);
                        return;
                    }
                    let valid = false;
                    const err = sock.authorizationError.toString();
                    switch (err) {
                        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
                        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
                        case 'SELF_SIGNED_CERT_IN_CHAIN':
                            if (opts.selfSigned) {
                                valid = true;
                            }
                            break;
                        case 'CERT_HAS_EXPIRED':
                            if (!opts.certExpired) {
                                valid = true;
                            }
                            break;
                        default:
                            // Fail on other errors
                    }
                    if (!valid) {
                        sock.destroy(sock.authorizationError);
                        throw Error(`Unable to create socket: ${err}`);
                    }
                    resolve(sock);
                });
                sock.once('error', (error) => {
                    reject(error);
                })
            });
        }
        return new Promise((resolve, reject) => {
            const socket = createConnection(opts, () => resolve(socket)) as Socket;
            socket.once('error', (error) => {
                reject(error);
            });
        });
    }

    private async handleConnectCommand(payload: IrcConnectionPoolCommandIn<InCommandType.Connect>) {
        const opts = payload.info;
        const { clientId } = payload.info;
        let connection: Socket;

        try {
            connection = await this.createConnectionForOpts(opts);
        }
        catch (ex) {
            log.error(`Failed to connect to ${opts.host}:${opts.port}`, ex);
            return this.sendCommandOut(OutCommandType.Error, {
                clientId,
                error: ex.message,
            });
        }

        log.info(
            `Connected ${clientId} to ${connection.remoteAddress}:${connection.remotePort}` +
            `(via ${connection.localAddress}:${connection.localPort})`
        );
        this.cmdWriter.hset(
            REDIS_IRC_POOL_CONNECTIONS, clientId, `${connection.localAddress}:${connection.localPort}`
        ).catch((ex) => {
            log.warn(`Unable to erase state for ${clientId}`, ex);
        });
        this.connections.set(clientId, connection);
        connectionsGauge.set(this.connections.size);

        connection.on('error', (ex) => {
            log.error(`Error on ${opts.host}:${opts.port}`, ex);
            this.sendCommandOut(OutCommandType.Error, {
                clientId,
                error: ex.message,
            });
        });

        connection.on('data', (data) => {
            // Read/write are special - We just send the full buffer
            if (!Buffer.isBuffer(data)) {
                // *Just* in case.
                data = Buffer.from(data);
            }

            // We need to respond to PINGs with a PONG even if the bridge is down to prevent our connections
            // from rapidly exploding. To do this, do a noddy check for PING and then a thorough check for
            // the message content. If the IRC bridge fails to respond to the PING, we send it for it.
            // If we send two PONGs by mistake, that's fine. We just need to be sure we sent at least one!
            if (data.includes('PING')) {
                const msg = parseMessage(data.toString('utf-8'), false);
                if (msg.command === 'PING') {
                    this.connectionPongTimeouts.set(clientId, setTimeout(() => {
                        log.warn(`Sending PONG for ${clientId}, since the bridge didn't respond fast enough.`);
                        connection.write('PONG ' + msg.args[0] + "\r\n");
                    }, TIME_TO_WAIT_BEFORE_PONG));
                }
            }

            // We write a magic string to prevent this being
            // possibly read as JSON on the other side.
            const toWrite = Buffer.concat(
                [
                    READ_BUFFER_MAGIC_BYTES,
                    data
                ]
            );

            this.cmdWriter.xaddBuffer(REDIS_IRC_POOL_COMMAND_OUT_STREAM, "*", clientId, toWrite).catch((ex) => {
                log.warn(`Unable to send raw read out`, ex);
            });
        });
        connection.on('close', () => {
            log.debug(`Closing connection for ${clientId}`);
            this.cmdWriter.hdel(REDIS_IRC_POOL_CONNECTIONS, clientId).catch((ex) => {
                log.warn(`Unable to erase connection key for ${clientId}`, ex);
            });
            this.cmdWriter.hdel(REDIS_IRC_CLIENT_STATE_KEY, payload.info.clientId).catch((ex) => {
                log.warn(`Unable to erase state for ${clientId}`, ex);
            });
            this.connections.delete(clientId);
            connectionsGauge.set(this.connections.size);
            this.sendCommandOut(OutCommandType.Disconnected, {
                clientId,
            });
        });

        return this.sendCommandOut(OutCommandType.Connected, {
            localIp: connection.localAddress ?? "unknown",
            localPort: connection.localPort ?? -1,
            clientId,
        });
    }

    private async handleDestroyCommand(payload: IrcConnectionPoolCommandIn<InCommandType.Destroy>) {
        const connection = this.connections.get(payload.info.clientId);
        if (!connection) {
            log.warn(`Got destroy but no connection matching ${payload.info.clientId} was found`);
            return;
        }
        connection.destroy();
    }

    private async handleEndCommand(payload: IrcConnectionPoolCommandIn<InCommandType.End>) {
        const connection = this.connections.get(payload.info.clientId);
        if (!connection) {
            log.warn(`Got end but no connection matching ${payload.info.clientId} was found`);
            return;
        }
        connection.end();
    }

    private async handleSetTimeoutCommand(payload: IrcConnectionPoolCommandIn<InCommandType.SetTimeout>) {
        const connection = this.connections.get(payload.info.clientId);
        if (!connection) {
            log.warn(`Got set-timeout but no connection matching ${payload.info.clientId} was found`);
            return;
        }
        connection.setTimeout(payload.info.timeout);
    }

    private async handleWriteCommand(payload: IrcConnectionPoolCommandIn<InCommandType.Write>) {
        const connection = this.connections.get(payload.info.clientId);

        // This is a *very* noddy check to see if the IRC bridge has sent back a pong.
        // It's not really important if this is correct, but it's key *this* process
        // sends back a PONG if nothing has been written to the connection.
        if (payload.info.data.startsWith('PONG')) {
            clearTimeout(this.connectionPongTimeouts.get(payload.info.clientId));
        }

        if (!connection) {
            log.warn(`Got write but no connection matching ${payload.info.clientId} was found`);
            return;
        }
        connection.write(payload.info.data);
        log.debug(`${payload.info.clientId} wrote ${payload.info.data.length} bytes`);
    }

    private async handleCommand<T extends InCommandType>(type: T, payload: IrcConnectionPoolCommandIn<T>) {
        // TODO: Ignore stale commands
        log.debug(`Got incoming command ${type} from ${payload.info.clientId}`);
        switch (type) {
            case InCommandType.Connect:
                // Spawn a connection
                await this.handleConnectCommand(payload as IrcConnectionPoolCommandIn<InCommandType.Connect>);
                break;
            case InCommandType.Destroy:
                // Spawn a connection
                await this.handleDestroyCommand(payload as IrcConnectionPoolCommandIn<InCommandType.Destroy>);
                break;
            case InCommandType.End:
                // Spawn a connection
                await this.handleEndCommand(payload as IrcConnectionPoolCommandIn<InCommandType.End>);
                break;
            case InCommandType.SetTimeout:
                // Spawn a connection
                await this.handleSetTimeoutCommand(payload as IrcConnectionPoolCommandIn<InCommandType.SetTimeout>);
                break;
            case InCommandType.Write:
                // Spawn a connection
                await this.handleWriteCommand(payload as IrcConnectionPoolCommandIn<InCommandType.Write>);
                break;
            case InCommandType.ConnectionPing:
                await this.handleInternalPing(payload as IrcConnectionPoolCommandIn<InCommandType.ConnectionPing>);
                break;
            case InCommandType.Ping:
                await this.sendCommandOut(OutCommandType.Pong, { });
                break;
            default:
                throw new CommandError("Type not understood", type);
        }
    }

    private async handleStreamCommand(cmdType: string, payload: string) {
        const commandType = cmdType as InCommandType;
        const commandData = JSON.parse(payload) as IrcConnectionPoolCommandIn<InCommandType>;
        return this.handleCommand(commandType, commandData);
    }

    public async handleInternalPing({ info }: IrcConnectionPoolCommandIn<InCommandType.ConnectionPing>) {
        const { clientId } = info;
        const conn = this.connections.get(clientId);
        if (!conn) {
            return this.sendCommandOut(OutCommandType.NotConnected, { clientId });
        }
        if (conn.readableEnded) {
            // Erp, somehow we missed this
            this.connections.delete(clientId);
            connectionsGauge.set(this.connections.size);
            await this.sendCommandOut(OutCommandType.Disconnected, { clientId });
            return this.sendCommandOut(OutCommandType.NotConnected, { clientId });
        }
        // Otherwise, it happy.
        return this.sendCommandOut(OutCommandType.Connected, { clientId });
    }

    public sendHeartbeat() {
        log.debug(`Sending heartbeat`);
        return this.cmdWriter.set(REDIS_IRC_POOL_HEARTBEAT_KEY, Date.now()).catch((ex) => {
            log.warn(`Unable to send heartbeat`, ex);
        });
    }

    private async trimCommandStream() {
        if (this.commandStreamId === '$') {
            // At the head of the queue, don't trim.
            return;
        }
        try {
            log.debug(`Trimming up to ${this.commandStreamId}`);
            const trimCount = await this.cmdWriter.xtrim(
                REDIS_IRC_POOL_COMMAND_IN_STREAM, "MINID", this.commandStreamId
            );
            log.debug(`Trimmed ${trimCount} commands from the IN stream`);
        }
        catch (ex) {
            log.warn(`Failed to trim commands from the IN stream`, ex);
        }
    }

    public async start() {
        if (this.shouldRun) {
            // Is already running!
            return;
        }
        this.shouldRun = true;
        Logger.configure({ console: this.config.loggingLevel });

        // Load metrics
        if (this.config.metricsHost) {
            this.metricsServer = createServer((request, response) => {
                if (request.url !== "/metrics") {
                    response.statusCode = 404;
                    response.write('Not found.');
                    response.end();
                    return;
                }
                if (request.method !== "GET") {
                    response.statusCode = 405;
                    response.write('Method not supported. Use GET.');
                    response.end();
                    return;
                }
                register.metrics().then(metrics => {
                    response.write(metrics);
                    response.end();
                }).catch(ex => {
                    log.error(`Could not read metrics`, ex);
                    response.statusCode = 500;
                    response.write('Failed to get metrics');
                    response.end();
                });
            }).listen(this.config.metricsPort, this.config.metricsHost, 10);
            await new Promise((resolve, reject) => {
                this.metricsServer?.once('listening', resolve);
                this.metricsServer?.once('error', reject);
            });
            log.info(`Listening for metrics on ${this.config.metricsHost}:${this.config.metricsPort}`);
        }

        await this.cmdReader.connect();
        await this.cmdWriter.connect();

        // Register yourself with redis and set the current protocol version
        await this.cmdWriter.set(REDIS_IRC_POOL_VERSION_KEY, PROTOCOL_VERSION);
        await this.sendHeartbeat();

        // Fetch the last read index.
        this.commandStreamId = "$";

        // Warn of any existing connections.
        await this.cmdWriter.del(REDIS_IRC_POOL_CONNECTIONS);
        await this.cmdWriter.del(REDIS_IRC_CLIENT_STATE_KEY);
        await this.cmdWriter.del(REDIS_IRC_POOL_COMMAND_IN_STREAM);
        await this.cmdWriter.del(REDIS_IRC_POOL_COMMAND_OUT_STREAM);

        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat().catch((ex) => {
                log.warn(`Failed to send heartbeat`, ex);
            });
            void this.trimCommandStream();
        }, HEARTBEAT_EVERY_MS);

        return this.commandReader.start();
    }

    public async close() {
        this.commandReader.stop();
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
        }
        await this.sendCommandOut(OutCommandType.PoolClosing, { });
        this.connections.forEach((socket) => {
            socket.write('QUIT :Process terminating\r\n');
            socket.end();
        });
        // Cleanup process.
        this.cmdWriter.quit();
        this.cmdReader.quit();
        this.shouldRun = false;
    }
}

if (require.main === module) {
    const pool = new IrcConnectionPool(Config);
    process.on("SIGINT", () => {
        log.info("SIGTERM recieved, killing pool");
        pool.close().then(() => {
            log.info("Completed cleanup, exiting");
        }).catch(err => {
            log.warn("Error while closing pool, exiting anyway", err);
            process.exit(1);
        })
    });

    pool.start().catch(ex => {
        log.error('Pool process encountered an error', ex);
    });
}
