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

import { Pool } from "pg";

import {
    MatrixUser,
    MatrixRoom,
    RemoteRoom,
    RoomBridgeStoreEntry as Entry,
    MatrixRoomData,
    ProvisionSession,
    ProvisioningStore,
    UserActivitySet,
    UserActivity,
} from "matrix-appservice-bridge";
import { DataStore, RoomOrigin, ChannelMappings, UserFeatures } from "../DataStore";
import { MatrixDirectoryVisibility } from "../../bridge/IrcHandler";
import { IrcRoom } from "../../models/IrcRoom";
import { IrcClientConfig } from "../../models/IrcClientConfig";
import { IrcServer, IrcServerConfig } from "../../irc/IrcServer";

import { getLogger } from "../../logging";
import Bluebird from "bluebird";
import { StringCrypto } from "../StringCrypto";
import { toIrcLowerCase } from "../../irc/formatting";
import { NeDBDataStore } from "../NedbDataStore";
import QuickLRU from "quick-lru";

const log = getLogger("PgDatastore");

const FEATURE_CACHE_SIZE = 512;

interface RoomRecord {
    room_id: string;
    irc_domain: string;
    irc_channel: string;
    matrix_json?: MatrixRoomData;
    irc_json: Record<string, unknown>;
    type: string;
    origin: RoomOrigin;
}

export class PgDataStore implements DataStore, ProvisioningStore {
    private serverMappings: {[domain: string]: IrcServer} = {};

    public static readonly LATEST_SCHEMA = 9;
    private pgPool: Pool;
    private hasEnded = false;
    private cryptoStore?: StringCrypto;
    private userFeatureCache = new QuickLRU<string, UserFeatures>({
        maxSize: FEATURE_CACHE_SIZE,
    });

    constructor(private bridgeDomain: string, connectionString: string, pkeyPath?: string, min = 1, max = 4) {
        this.pgPool = new Pool({
            connectionString,
            min,
            max,
        });
        this.pgPool.on("error", (err) => {
            log.error("Postgres Error: %s", err);
        });
        if (pkeyPath) {
            this.cryptoStore = new StringCrypto();
            this.cryptoStore.load(pkeyPath);
        }
        process.on("beforeExit", () => {
            if (this.hasEnded) {
                return;
            }
            // Ensure we clean up on exit
            this.pgPool.end();
        })
    }

    public async setServerFromConfig(server: IrcServer, serverConfig: IrcServerConfig): Promise<void> {
        this.serverMappings[server.domain] = server;

        for (const channel of Object.keys(serverConfig.mappings)) {
            const ircRoom = new IrcRoom(server, channel);
            ircRoom.set("type", "channel");
            for (const roomId of serverConfig.mappings[channel].roomIds) {
                const mxRoom = new MatrixRoom(roomId);
                await this.storeRoom(ircRoom, mxRoom, "config");
            }
        }
    }

    public async storeRoom(ircRoom: IrcRoom, matrixRoom: MatrixRoom, origin: RoomOrigin): Promise<void> {
        if (typeof origin !== "string") {
            throw new Error('Origin must be a string = "config"|"provision"|"alias"|"join"');
        }
        log.info("storeRoom (id=%s, addr=%s, chan=%s, origin=%s, type=%s)",
            matrixRoom.getId(), ircRoom.getDomain(), ircRoom.channel, origin, ircRoom.getType());
        // We need to *clone* this as we are about to be evil.
        const ircRoomSerial = JSON.parse(JSON.stringify(ircRoom.serialize()));
        // These keys do not need to be stored inside the JSON blob as we store them
        // inside dedicated columns. They will be reinserted into the JSON blob
        // when fetched.
        const type = ircRoom.getType();
        const domain = ircRoom.getDomain();
        const channel = ircRoom.getChannel();
        delete ircRoomSerial.domain;
        delete ircRoomSerial.channel;
        delete ircRoomSerial.type;
        await this.upsertRoom(
            origin,
            type,
            domain,
            channel,
            matrixRoom.getId(),
            JSON.stringify(ircRoomSerial),
            JSON.stringify(matrixRoom.serialize()),
        );
    }

    public async upsertRoom(
        origin: RoomOrigin,
        type: string,
        domain: string,
        channel: string,
        roomId: string,
        ircJson: string,
        matrixJson: string
    ) {
        const parameters = {
            origin,
            type,
            irc_domain: domain,
            irc_channel: channel,
            room_id: roomId,
            irc_json: ircJson,
            matrix_json: matrixJson,
        };
        const statement = PgDataStore.BuildUpsertStatement("rooms",
            "ON CONSTRAINT cons_rooms_unique", Object.keys(parameters));
        await this.pgPool.query(statement, Object.values(parameters));
    }

    private static pgToRoomEntry(pgEntry: RoomRecord): Entry {
        return {
            id: NeDBDataStore.createMappingId(pgEntry.room_id, pgEntry.irc_domain, pgEntry.irc_channel),
            matrix: new MatrixRoom(pgEntry.room_id, pgEntry.matrix_json),
            remote: new RemoteRoom("",
                {
                    ...pgEntry.irc_json,
                    channel: pgEntry.irc_channel,
                    domain: pgEntry.irc_domain,
                    type: pgEntry.type,
                }),
            data: {
                origin: pgEntry.origin,
            },
        };
    }

    public async getRoom(
        roomId: string,
        ircDomain: string,
        ircChannel: string,
        origin?: RoomOrigin
    ): Promise<Entry | null> {
        let statement = "SELECT * FROM rooms WHERE room_id = $1 AND irc_domain = $2 AND irc_channel = $3";
        let params = [roomId, ircDomain, ircChannel];
        if (origin) {
            statement += " AND origin = $4";
            params = params.concat(origin);
        }
        const pgEntry = await this.pgPool.query<RoomRecord>(statement, params);
        if (!pgEntry.rowCount) {
            return null;
        }
        return PgDataStore.pgToRoomEntry(pgEntry.rows[0]);
    }

    public async getAllChannelMappings(): Promise<ChannelMappings> {
        const entries = (await this.pgPool.query(
            "SELECT irc_domain, room_id, irc_channel FROM rooms WHERE type = 'channel'"
        )).rows;

        const mappings: ChannelMappings = {};
        const validDomains = Object.keys(this.serverMappings);
        entries.forEach((e) => {
            if (!e.room_id) {
                return;
            }
            // Filter out servers we don't know about
            if (!validDomains.includes(e.irc_domain)) {
                return;
            }
            if (!mappings[e.room_id]) {
                mappings[e.room_id] = [];
            }
            mappings[e.room_id].push({
                networkId: this.serverMappings[e.irc_domain].getNetworkId(),
                channel: e.irc_channel,
            });
        })

        return mappings;
    }

    public getEntriesByMatrixId(roomId: string): Bluebird<Entry[]> {
        return Bluebird.cast(this.pgPool.query("SELECT * FROM rooms WHERE room_id = $1", [
            roomId
        ])).then((result) => result.rows).map((e) => PgDataStore.pgToRoomEntry(e));
    }

    public async getProvisionedMappings(roomId: string): Promise<Entry[]> {
        const res = await this.pgPool.query("SELECT * FROM rooms WHERE room_id = $1 AND origin = 'provision'", [
            roomId
        ]).then((result) => result.rows);
        return res.map((e) => PgDataStore.pgToRoomEntry(e));
    }

    public async removeRoom(roomId: string, ircDomain: string, ircChannel: string, origin?: RoomOrigin): Promise<void> {
        let statement = "DELETE FROM rooms WHERE room_id = $1 AND irc_domain = $2 AND irc_channel = $3";
        let params = [roomId, ircDomain, ircChannel];
        if (origin) {
            statement += " AND origin = $4";
            params = params.concat(origin);
        }
        await this.pgPool.query(statement, params);
    }

    public async getIrcChannelsForRoomId(roomId: string): Promise<IrcRoom[]> {
        let entries = await this.pgPool.query("SELECT irc_domain, irc_channel FROM rooms WHERE room_id = $1", [roomId]);
        if (entries.rowCount === 0) {
            // Could be a PM room, if it's not a channel.
            entries = await this.pgPool.query("SELECT irc_domain, irc_nick FROM pm_rooms WHERE room_id = $1", [roomId]);
        }
        const rooms: IrcRoom[] = [];
        for (const row of entries.rows) {
            const server = this.serverMappings[row.irc_domain];
            if (server) {
                rooms.push(new IrcRoom(server, row.irc_channel || row.irc_nick));
            }
        }
        return rooms;
    }

    public async getIrcChannelsForRoomIds(roomIds: string[]): Promise<{ [roomId: string]: IrcRoom[] }> {
        const entries = await this.pgPool.query(
            "SELECT room_id, irc_domain, irc_channel FROM rooms WHERE room_id = ANY($1)",
            [roomIds]
        );
        const mapping: { [roomId: string]: IrcRoom[] } = {};
        entries.rows.forEach((e) => {
            const server = this.serverMappings[e.irc_domain];
            if (!server) {
                // ! is used here because typescript doesn't understand the .filter
                return;
            }
            if (!mapping[e.room_id]) {
                mapping[e.room_id] = [];
            }
            mapping[e.room_id].push(new IrcRoom(server, e.irc_channel));
        });
        return mapping;
    }

    public async getMatrixRoomsForChannel(server: IrcServer, channel: string): Promise<MatrixRoom[]> {
        const entries = await this.pgPool.query(
            "SELECT room_id, matrix_json FROM rooms WHERE irc_domain = $1 AND irc_channel = $2",
            [
                server.domain,
                // Channels must be lowercase
                toIrcLowerCase(channel),
            ]);
        return entries.rows.map((e) => new MatrixRoom(e.room_id, e.matrix_json));
    }

    public async getMappingsForChannelByOrigin(
        server: IrcServer,
        channel: string,
        origin: RoomOrigin | RoomOrigin[],
    ): Promise<Entry[]> {
        if (!Array.isArray(origin)) {
            origin = [origin];
        }
        const entries = await this.pgPool.query<RoomRecord>(
            "SELECT * FROM rooms WHERE irc_domain = $1 AND irc_channel = $2 AND origin = ANY($3)",
            [
                server.domain,
                // Channels must be lowercase
                toIrcLowerCase(channel),
                origin,
            ]);
        return entries.rows.map((e) => PgDataStore.pgToRoomEntry(e));
    }

    public async getModesForChannel(server: IrcServer, channel: string): Promise<{ [id: string]: string[] }> {
        log.debug(`Getting modes for ${server.domain} ${channel}`);
        const mapping: {[id: string]: string[]} = {};
        const entries = await this.pgPool.query(
            "SELECT room_id, irc_json->>'modes' AS modes FROM rooms " +
            "WHERE irc_domain = $1 AND irc_channel = $2",
            [
                server.domain,
                // Channels must be lowercase
                toIrcLowerCase(channel),
            ]);
        entries.rows.forEach((e) => {
            mapping[e.room_id] = e.modes || [];
        });
        return mapping;
    }

    public async setModeForRoom(roomId: string, mode: string, enabled: boolean): Promise<void> {
        log.info("setModeForRoom (mode=%s, roomId=%s, enabled=%s)",
            mode, roomId, enabled
        );
        const entries: Entry[] = await this.getEntriesByMatrixId(roomId);
        for (const entry of entries) {
            if (!entry.remote) {
                continue;
            }
            const modes = entry.remote.get("modes") as string[] || [];
            const hasMode = modes.includes(mode);

            if (hasMode === enabled) {
                continue;
            }
            if (enabled) {
                modes.push(mode);
            }
            else {
                modes.splice(modes.indexOf(mode), 1);
            }

            entry.remote.set("modes", modes);
            // Clone the object
            const ircRoomSerial = JSON.parse(JSON.stringify(entry.remote.serialize()));
            delete ircRoomSerial.domain;
            delete ircRoomSerial.channel;
            delete ircRoomSerial.type;
            await this.pgPool.query(
                "UPDATE rooms SET irc_json = $4 WHERE room_id = $1 AND irc_channel = $2 AND irc_domain = $3",
                [
                    roomId,
                    entry.remote.get("channel"),
                    entry.remote.get("domain"),
                    JSON.stringify(ircRoomSerial),
                ]
            );
        }
    }

    public async setPmRoom(ircRoom: IrcRoom, matrixRoom: MatrixRoom, userId: string,
                           virtualUserId: string
    ): Promise<void> {
        log.debug(`setPmRoom (matrix_user_id=${userId}, virtual_user_id=${virtualUserId}, ` +
            `room_id=${matrixRoom.getId()}, irc_nick=${ircRoom.getChannel()})`);
        await this.pgPool.query(
            PgDataStore.BuildUpsertStatement("pm_rooms", "ON CONSTRAINT cons_pm_rooms_matrix_irc_unique", [
                "room_id",
                "irc_domain",
                "irc_nick",
                "matrix_user_id",
                "virtual_user_id",
            ]), [
                matrixRoom.getId(),
                ircRoom.getDomain(),
                ircRoom.getChannel(),
                userId,
                virtualUserId,
            ]);
    }

    public async removePmRoom(roomId: string): Promise<void> {
        log.debug(`removePmRoom (room_id=${roomId}`);
        await this.pgPool.query("DELETE FROM pm_rooms WHERE room_id = $1", [roomId]);
    }

    public async getMatrixPmRoom(realUserId: string, virtualUserId: string): Promise<MatrixRoom|null> {
        log.debug(`getMatrixPmRoom (matrix_user_id=${realUserId}, virtual_user_id=${virtualUserId})`);
        const res = await this.pgPool.query(
            "SELECT room_id FROM pm_rooms WHERE matrix_user_id = $1 AND virtual_user_id = $2",
            [
                realUserId,
                virtualUserId,
            ]
        );
        if (res.rowCount === 0) {
            return null;
        }
        return new MatrixRoom(res.rows[0].room_id);
    }

    public async getMatrixPmRoomById(roomId: string): Promise<MatrixRoom|null> {
        log.debug(`getMatrixPmRoom (roomId=${roomId})`);
        const res = await this.pgPool.query(
            "SELECT room_id, matrix_user_id, virtual_user_id FROM pm_rooms WHERE room_id = $1", [
                roomId,
            ]);
        if (res.rowCount === 0) {
            return null;
        }
        return new MatrixRoom(res.rows[0].room_id);
    }

    public async getTrackedChannelsForServer(domain: string): Promise<string[]> {
        if (!this.serverMappings[domain]) {
            // Return empty if we don't know the server.
            return [];
        }
        log.info(`Fetching all channels for ${domain}`);
        const chanSet = await this.pgPool.query(
            "SELECT DISTINCT irc_channel FROM rooms WHERE irc_domain = $1", [domain]);
        return chanSet.rows.map((e) => e.irc_channel as string);
    }

    public async getRoomIdsFromConfig(): Promise<string[]> {
        return (
            await this.pgPool.query("SELECT room_id FROM rooms WHERE origin = 'config'")
        ).rows.map((e) => e.room_id);
    }

    public async removeConfigMappings(): Promise<void> {
        await this.pgPool.query("DELETE FROM rooms WHERE origin = 'config'");
    }

    public async getIpv6Counter(server: IrcServer, homeserver: string|null): Promise<number> {
        homeserver = homeserver || "*";
        const res = await this.pgPool.query(
            "SELECT count FROM ipv6_counter WHERE server = $1 AND homeserver = $2",
            [server.domain, homeserver]
        );
        return res.rows[0]?.count !== undefined ? parseInt(res.rows[0].count, 10) : 0;
    }

    public async setIpv6Counter(counter: number, server: IrcServer, homeserver: string|null): Promise<void> {
        await this.pgPool.query(
            PgDataStore.BuildUpsertStatement(
                "ipv6_counter",
                "ON CONSTRAINT cons_ipv6_counter_unique", [
                    "count",
                    "homeserver",
                    "server"
                ],
            ),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [counter, homeserver || "*", server.domain] as any[],
        );
    }

    public async upsertMatrixRoom(room: MatrixRoom): Promise<void> {
        // XXX: This is an upsert operation, but we don't have enough details to go on
        // so this will just update a rooms data entry. We only use this call to update
        // topics on an existing room.
        await this.pgPool.query("UPDATE rooms SET matrix_json = $1 WHERE room_id = $2", [
            JSON.stringify(room.serialize()),
            room.getId(),
        ]);
    }

    public async getAdminRoomById(roomId: string): Promise<MatrixRoom|null> {
        const res = await this.pgPool.query("SELECT room_id FROM admin_rooms WHERE room_id = $1", [roomId]);
        if (res.rowCount === 0) {
            return null;
        }
        return new MatrixRoom(roomId);
    }

    public async storeAdminRoom(room: MatrixRoom, userId: string): Promise<void> {
        await this.pgPool.query(PgDataStore.BuildUpsertStatement("admin_rooms", "(room_id)", [
            "room_id",
            "user_id",
        ]), [room.getId(), userId]);
    }

    public async getAdminRoomByUserId(userId: string): Promise<MatrixRoom|null> {
        const res = await this.pgPool.query("SELECT room_id FROM admin_rooms WHERE user_id = $1", [userId]);
        if (res.rowCount === 0) {
            return null;
        }
        return new MatrixRoom(res.rows[0].room_id);
    }

    public async removeAdminRoom(room: MatrixRoom): Promise<void> {
        await this.pgPool.query("DELETE FROM admin_rooms WHERE room_id = $1", [room.roomId]);
    }

    public async storeMatrixUser(matrixUser: MatrixUser): Promise<void> {
        const parameters = {
            user_id: matrixUser.getId(),
            data: JSON.stringify(matrixUser.serialize()),
        };
        const statement = PgDataStore.BuildUpsertStatement("matrix_users", "(user_id)", Object.keys(parameters));
        await this.pgPool.query(statement, Object.values(parameters));
    }

    public async getIrcClientConfig(userId: string, domain: string): Promise<IrcClientConfig | null> {
        const res = await this.pgPool.query(
            "SELECT config, password FROM client_config WHERE user_id = $1 and domain = $2",
            [
                userId,
                domain
            ]);
        if (res.rowCount === 0) {
            return null;
        }
        const row = res.rows[0];
        const config = row.config || {}; // This may not be defined.
        if (row.password && this.cryptoStore) {
            // NOT fatal, but really worrying.
            try {
                config.password = this.cryptoStore.decrypt(row.password);
            }
            catch (ex) {
                log.warn(`Failed to decrypt password for ${userId} ${domain}`, ex);
            }
        }
        return new IrcClientConfig(userId, domain, config);
    }

    public async storeIrcClientConfig(config: IrcClientConfig): Promise<void> {
        const userId = config.getUserId();
        if (!userId) {
            throw Error("IrcClientConfig does not contain a userId");
        }
        log.debug(`Storing client configuration for ${userId}`);
        // We need to make sure we have a matrix user in the store.
        await this.pgPool.query("INSERT INTO matrix_users VALUES ($1, NULL) ON CONFLICT DO NOTHING", [userId]);
        let password = config.getPassword();
        if (password && this.cryptoStore) {
            password = this.cryptoStore.encrypt(password);
        }
        const parameters = {
            user_id: userId,
            domain: config.getDomain(),
            // either use the decrypted password, or whatever is stored already.
            password,
            config: JSON.stringify(config.serialize(true)),
        };
        const statement = PgDataStore.BuildUpsertStatement(
            "client_config", "ON CONSTRAINT cons_client_config_unique", Object.keys(parameters));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.pgPool.query(statement, Object.values(parameters) as any[]);
    }


    public async ensurePasskeyCanDecrypt(): Promise<void> {
        if (!this.cryptoStore) {
            return;
        }
        const res = await this.pgPool.query<{password: string, user_id: string, domain: string}>(
            "SELECT password, user_id, domain FROM client_config WHERE password IS NOT NULL");
        for (const { password, user_id, domain } of res.rows) {
            try {
                this.cryptoStore.decrypt(password);
            }
            catch (ex) {
                log.error(`Failed to decrypt password for ${user_id} on ${domain}`, ex);
                throw Error('Cannot decrypt user password, refusing to continue', { cause: ex });
            }
        }
    }

    public async getMatrixUserByLocalpart(localpart: string): Promise<MatrixUser|null> {
        const res = await this.pgPool.query("SELECT user_id, data FROM matrix_users WHERE user_id = $1", [
            `@${localpart}:${this.bridgeDomain}`,
        ]);
        if (res.rowCount === 0) {
            return null;
        }
        const row = res.rows[0];
        return new MatrixUser(row.user_id, row.data);
    }

    public async getUserFeatures(userId: string): Promise<UserFeatures> {
        const existing = this.userFeatureCache.get(userId);
        if (existing) {
            return existing;
        }
        const pgRes = await this.pgPool.query("SELECT features FROM user_features WHERE user_id = $1", [userId]);
        const features = (pgRes.rows[0] || {});
        this.userFeatureCache.set(userId, features);
        return features;
    }

    public async storeUserFeatures(userId: string, features: UserFeatures): Promise<void> {
        const statement = PgDataStore.BuildUpsertStatement("user_features", "(user_id)", [
            "user_id",
            "features",
        ]);
        await this.pgPool.query(statement, [userId, JSON.stringify(features)]);
    }

    public async getUserActivity(): Promise<UserActivitySet> {
        const res = await this.pgPool.query('SELECT * FROM user_activity');
        const activity = new Map<string, UserActivity>();
        for (const row of res.rows) {
            activity.set(row['user_id'], row['data']);
        }
        return activity;
    }

    public async storeUserActivity(userId: string, activity: UserActivity) {
        const stmt = PgDataStore.BuildUpsertStatement(
            'user_activity',
            '(user_id)',
            ['user_id', 'data'],
        );
        await this.pgPool.query(stmt, [userId, JSON.stringify(activity)]);
    }

    public async storePass(userId: string, domain: string, pass: string, encrypt = true): Promise<void> {
        let password = pass;
        if (encrypt) {
            if (!this.cryptoStore) {
                throw Error("Password encryption is not configured.")
            }
            password = this.cryptoStore.encrypt(pass);
        }
        const parameters = {
            user_id: userId,
            domain,
            password,
        };
        const statement = PgDataStore.BuildUpsertStatement("client_config",
            "ON CONSTRAINT cons_client_config_unique", Object.keys(parameters));
        await this.pgPool.query(statement, Object.values(parameters));
    }

    public async removePass(userId: string, domain: string): Promise<void> {
        await this.pgPool.query("UPDATE client_config SET password = NULL WHERE user_id = $1 AND domain = $2",
            [userId, domain]);
    }

    public async getMatrixUserByUsername(domain: string, username: string): Promise<MatrixUser|undefined> {
        // This will need a join
        const res = await this.pgPool.query(
            "SELECT client_config.user_id, matrix_users.data FROM client_config, matrix_users " +
            "WHERE config->>'username' = $1 AND domain = $2 AND client_config.user_id = matrix_users.user_id",
            [username, domain]
        );
        if (res.rowCount === 0) {
            return undefined;
        }
        else if (res.rowCount! > 1) {
            log.error("getMatrixUserByUsername returned %s results for %s on %s", res.rowCount, username, domain);
        }
        return new MatrixUser(res.rows[0].user_id, res.rows[0].data);
    }

    public async getCountForUsernamePrefix(domain: string, usernamePrefix: string): Promise<number> {
        const res = await this.pgPool.query("SELECT COUNT(*) FROM client_config " +
            "WHERE domain = $2 AND config->>'username' LIKE $1 || '%'",
        [usernamePrefix, domain]);
        const count = parseInt(res.rows[0].count, 10);
        return count;
    }

    public async roomUpgradeOnRoomMigrated(oldRoomId: string, newRoomId: string) {
        await this.pgPool.query("UPDATE rooms SET room_id = $1 WHERE room_id = $2", [newRoomId, oldRoomId]);
    }

    public async updateLastSeenTimeForUser(userId: string) {
        const statement = PgDataStore.BuildUpsertStatement("last_seen", "(user_id)", [
            "user_id",
            "ts",
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.pgPool.query(statement, [userId, Date.now()] as any[]);
    }

    public async getLastSeenTimeForUsers(): Promise<{ user_id: string; ts: number }[]> {
        const res = await this.pgPool.query(`SELECT * FROM last_seen`);
        return res.rows;
    }

    public async getAllUserIds() {
        const res = await this.pgPool.query(`SELECT user_id FROM matrix_users`);
        return res.rows.map((u) => u.user_id);
    }

    public async getRoomsVisibility(roomIds: string[]): Promise<Map<string, MatrixDirectoryVisibility>> {
        const map: Map<string, MatrixDirectoryVisibility> = new Map(
            roomIds.map(r => [r, 'private'])
        );
        const res = await this.pgPool.query(
            "SELECT room_id, visibility FROM room_visibility WHERE room_id = ANY($1)",
            [roomIds]
        );
        for (const row of res.rows) {
            map.set(row.room_id, row.visibility ? "public" : "private");
        }
        return map;
    }

    public async setRoomVisibility(roomId: string, visibility: MatrixDirectoryVisibility) {
        const statement = PgDataStore.BuildUpsertStatement("room_visibility", "(room_id)", [
            "room_id",
            "visibility",
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.pgPool.query(statement, [roomId, visibility === "public"] as any[]);
        log.info(`setRoomVisibility ${roomId} => ${visibility}`);
    }

    public async isUserDeactivated(userId: string): Promise<boolean> {
        const res = await this.pgPool.query(`SELECT user_id FROM deactivated_users WHERE user_id = $1`, [userId]);
        return res.rowCount! > 0;
    }

    public async deactivateUser(userId: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.pgPool.query("INSERT INTO deactivated_users VALUES ($1, $2)", [userId, Date.now()] as any[]);
    }

    public async ensureSchema() {
        log.info("Starting postgres database engine");
        let currentVersion = await this.getSchemaVersion();
        while (currentVersion < PgDataStore.LATEST_SCHEMA) {
            log.info(`Updating schema to v${currentVersion + 1}`);
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const runSchema = require(`./schema/v${currentVersion + 1}`).runSchema;
            try {
                await runSchema(this.pgPool);
                currentVersion++;
                await this.updateSchemaVersion(currentVersion);
            }
            catch (ex) {
                log.warn(`Failed to run schema v${currentVersion + 1}:`, ex);
                throw Error("Failed to update database schema");
            }
        }
        log.info(`Database schema is at version v${currentVersion}`);
    }

    public async getRoomCount(): Promise<number> {
        const res = await this.pgPool.query<{count: string}>(`SELECT COUNT(*) FROM rooms`);
        return parseInt(res.rows[0]?.count || "0", 10);
    }

    public async getSessionForToken(token: string): Promise<ProvisionSession | null> {
        const result = await this.pgPool.query<{user_id: string, expires_ts: number}>(
            "SELECT user_id, expires_ts FROM provisioner_sessions WHERE token = $1", [token]
        );
        const row = result.rows[0];
        return row ? {
            userId: row.user_id,
            token,
            expiresTs: row.expires_ts,
        } : null;
    }

    public async createSession(session: ProvisionSession) {
        await this.pgPool.query<{user_id: string, expires_ts: number}>(
            "INSERT INTO provisioner_sessions VALUES ($1, $2, $3)", [session.userId, session.token, session.expiresTs]
        );
    }

    public async deleteSession(token: string) {
        await this.pgPool.query<{user_id: string, expires_ts: number}>(
            "DELETE FROM provisioner_sessions WHERE token = $1", [token]
        );
    }

    public async deleteAllSessions(userId: string) {
        await this.pgPool.query<{user_id: string, expires_ts: number}>(
            "DELETE FROM provisioner_sessions WHERE user_id = $1", [userId]
        );
    }

    public async destroy() {
        log.info("Destroy called");
        if (this.hasEnded) {
            // No-op if end has already been called.
            return;
        }
        this.hasEnded = true;
        await this.pgPool.end();
        log.info("PostgresSQL connection ended");
        // This will no-op
    }

    private async updateSchemaVersion(version: number) {
        log.debug(`updateSchemaVersion: ${version}`);
        await this.pgPool.query("UPDATE schema SET version = $1;", [version]);
    }

    private async getSchemaVersion(): Promise<number> {
        try {
            const { rows } = await this.pgPool.query("SELECT version FROM SCHEMA");
            return rows[0].version;
        }
        catch (ex) {
            if (ex.code === "42P01") { // undefined_table
                log.warn("Schema table could not be found");
                return 0;
            }
            log.error("Failed to get schema version: %s", ex);
        }
        throw Error("Couldn't fetch schema version");
    }

    private static BuildUpsertStatement(table: string, constraint: string, keyNames: string[]): string {
        const keys = keyNames.join(", ");
        const keysValues = `\$${keyNames.map((k, i) => i + 1).join(", $")}`;
        const keysSets = keyNames.map((k, i) => `${k} = \$${i + 1}`).join(", ");
        const statement = `INSERT INTO ${table} (${keys}) VALUES (${keysValues}) ` +
            `ON CONFLICT ${constraint} DO UPDATE SET ${keysSets}`;
        return statement;
    }
}
