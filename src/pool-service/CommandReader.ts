import { Redis } from "ioredis";
import semver from "semver";
import { Logger } from "matrix-appservice-bridge";

const TRIM_EVERY_MS = 30000;
const COMMAND_BLOCK_TIMEOUT = 10000;
const TRIM_MAXLEN_COUNT = 100_000;

const log = new Logger('RedisCommandReader');

export class RedisCommandReader {
    private shouldRun = true;
    private commandStreamId = "$"
    private supportsMinId = false;
    private trimInterval?: NodeJS.Timeout;

    constructor(
        private readonly redis: Redis,
        private readonly streamName: string,
        private readonly onCommand: (cmdType: string, cmdPayload: string) => Promise<void>) {

    }

    private updateLastRead(lastRead: string) {
        this.commandStreamId = lastRead;
    }

    public stop() {
        this.shouldRun = false;
        clearInterval(this.trimInterval);
    }

    public async readQueue() {
        const newCmds = await this.redis.xread(
            "BLOCK", COMMAND_BLOCK_TIMEOUT, "STREAMS", this.streamName, this.commandStreamId
        ).catch(ex => {
            log.warn(`Failed to read new command:`, ex);
            return null;
        });
        if (newCmds === null) {
            // This means we've waited for some time and seen no new commands, to be safe revert to the HEAD of the queue.
            log.info(`Stream has been idle for ${COMMAND_BLOCK_TIMEOUT}ms, listening for messages at $`);
            this.commandStreamId = '$';
            return;
        }
        // This is a list of keys, containing a list of commands, hence needing to deeply extract the values.
        for (const [msgId, [cmdType, payload]] of newCmds[0][1]) {
            // If we crash, we don't want to get stuck on this msg.
            this.updateLastRead(msgId);
            setImmediate(
                () => this.onCommand(cmdType, payload)
                    .catch(ex => log.warn(`Failed to handle msg ${msgId} (${cmdType}, ${payload})`, ex)
                    ),
            );
        }

    }

    public async getSupported() {
        let options: Map<string, string>;
        try {
            // Fetch the "Server" info block and parse out the various lines.
            const serverLines = (
                await this.redis.info("Server")
            ).split('\n').filter(v => !v.startsWith('#')).map(v => v.split(':', 2)) as [string, string][];
            options = new Map(serverLines);
        }
        catch (ex) {
            log.error("Failed to fetch server info from Redis", ex);
            // Treat it as if we got zero useful options back.
            options = new Map();
        }
        const version = options.get('redis_version');
        if (!version) {
            log.warn(`Unable to identify Redis version, assuming unsupported version.`);
            this.supportsMinId = false;
            return;
        }
        // We did get a server version back but we know it's unsupported.
        if (semver.lt(version, '5.0.0')) {
            throw new Error('Redis version is unsupported. The minimum required version is 5.0.0');
        }
        this.supportsMinId = !!semver.satisfies(version, '>=6.2');
    }

    private async trimCommandStream() {
        if (this.commandStreamId === '$') {
            // At the head of the queue, don't trim.
            return;
        }
        try {
            let trimCount;
            if (this.supportsMinId) {
                trimCount = await this.redis.xtrim(
                    this.streamName, "MINID", this.commandStreamId
                );
            }
            else {
                // If Redis doesn't support minid (requires >=6.2), we can fallback to
                // trimming a large amount of messages instead.
                trimCount = await this.redis.xtrim(
                    this.streamName, "MAXLEN", TRIM_MAXLEN_COUNT
                );
            }
            log.debug(`Trimmed ${trimCount} commands from the stream`);
        }
        catch (ex) {
            log.warn(`Failed to trim commands from the stream`, ex);
        }
    }

    public async start() {
        await this.getSupported();
        this.trimInterval = setInterval(this.trimCommandStream.bind(this), TRIM_EVERY_MS);
        log.info(`Listening for new commands`);
        let loopCommandCheck: () => void;
        // eslint-disable-next-line prefer-const
        loopCommandCheck = () => {
            if (!this.shouldRun) {
                log.info(`Finished`);
                return;
            }
            this.readQueue().finally(() => {
                return loopCommandCheck();
            });
        }

        loopCommandCheck();
    }
}
