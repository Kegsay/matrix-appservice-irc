import { IrcServerConfig } from "../irc/IrcServer";
import { LoggerConfig } from "../logging";
import { IrcHandlerConfig } from "../bridge/IrcHandler";
import { RoomConfigConfig } from "../bridge/RoomConfig";
import { MatrixHandlerConfig } from "../bridge/MatrixHandler";
import { ProvisionerConfig } from "../provisioning/Provisioner";
import { MatrixBanSyncConfig } from "../bridge/MatrixBanSync";

export interface BridgeConfig {
    database: {
        engine: string;
        connectionString: string;
    };
    homeserver: {
        url: string;
        domain: string;
        enablePresence?: boolean;
        dropMatrixMessagesAfterSecs?: number;
        bindHostname?: string;
        bindPort?: number;
    };
    ircService: {
        servers: {[domain: string]: IrcServerConfig};
        matrixHandler?: MatrixHandlerConfig;
        mediaProxy: {
            signingKeyPath: string;
            ttlSeconds: number;
            bindPort: number;
            publicUrl: string;
        };
        ircHandler?: IrcHandlerConfig;
        provisioning: ProvisionerConfig;
        logging: LoggerConfig;
        debugApi: {
            enabled: boolean;
            port: number;
        };
        /** @deprecated Use `BridgeConfig.database` */
        databaseUri?: string;
        metrics?: {
            enabled: boolean;
            port?: number;
            host?: string;
            userActivityThresholdHours?: number;
            remoteUserAgeBuckets: string[];
        };
        passwordEncryptionKeyPath?: string;
        ident: {
            enabled: boolean;
            address: string;
            port: number;
        };
        bridgeInfoState?: {
            enabled: boolean;
            initial: boolean;
        };
        encodingFallback?: string;
        permissions?: {
            [userIdOrDomain: string]: "admin";
        };
        perRoomConfig?: RoomConfigConfig;
        RMAUlimit?: number;
        userActivity?: {
            minUserActiveDays?: number;
            inactiveAfterDays?: number;
        };
        banLists?: MatrixBanSyncConfig;
    };
    sentry?: {
        enabled: boolean;
        dsn: string;
        environment?: string;
        serverName?: string;
    };
    advanced?: {
        maxHttpSockets: number;
        maxTxnSize?: number;
    };
    connectionPool?: {
        redisUrl: string;
        persistConnectionsOnShutdown?: boolean;
    }
}
