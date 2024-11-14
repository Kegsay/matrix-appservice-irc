/**
 * Synchronises Matrix `m.policy.rule` events with the bridge to filter specific
 * users from using the service.
 */

import { Intent, MatrixUser, WeakStateEvent } from "matrix-appservice-bridge";
import { MatrixGlob } from "matrix-bot-sdk";
import { getLogger } from "../logging";

const log = getLogger("MatrixBanSync");
export interface MatrixBanSyncConfig {
    rooms: string[];
    serverBanLists?: { [ircServer: string]: string };
}

enum BanEntityType {
    Server = "m.policy.rule.server",
    User = "m.policy.rule.user"
}

interface BanEntity {
    matcher: MatrixGlob;
    entityType: BanEntityType;
    reason: string;
}

interface MPolicyContent {
    entity: string;
    reason: string;
    recommendation: "m.ban";
}

function eventTypeToBanEntityType(eventType: string): BanEntityType|null {
    // `m.room.*` variants were in use until https://github.com/matrix-org/mjolnir/pull/336 by Mjolnir. For compatibilty we accept it.
    switch (eventType) {
        case "m.policy.rule.user":
        case "m.room.rule.user":
        case "org.matrix.mjolnir.rule.user":
            return BanEntityType.User;
        case "m.policy.rule.server":
        case "m.room.rule.server":
        case "org.matrix.mjolnir.rule.server":
            return BanEntityType.Server
        default:
            return null;
    }
}

const supportedRecommendations = [
    "org.matrix.mjolnir.ban", // Used historically.
    "m.ban"
];

export class MatrixBanSync {
    private bannedEntites = new Map<string, BanEntity>();
    private subscribedRooms = new Set<string>();
    private ircServerBanRooms = new Map<string, string>();
    constructor(private intent: Intent, private config: MatrixBanSyncConfig) { }

    public async markUserAsBanned(ircServer: string, mxid: string, reason = "k-lined"): Promise<void> {
        this.bannedEntites.set(mxid, {
            matcher: new MatrixGlob(mxid),
            entityType: BanEntityType.User,
            reason: reason,
        });

        const roomId = this.ircServerBanRooms.get(ircServer);
        if (!roomId) {
            log.warn(`No serverBanList configured for ${ircServer}; Matrix policy will not be created for ${mxid}`);
            return;
        }

        await this.intent.sendStateEvent(roomId, 'm.policy.rule.user', `rule:${mxid}`, {
            "entity": mxid,
            "reason": reason,
            "recommendation": "m.ban"
        });
    }

    public async syncRules() {
        this.bannedEntites.clear();
        this.subscribedRooms.clear();
        for (const roomIdOrAlias of this.config.rooms) {
            try {
                const roomId = await this.intent.join(roomIdOrAlias);
                this.subscribedRooms.add(roomId);
                const roomState = await this.intent.roomState(roomId, false) as WeakStateEvent[];
                for (const evt of roomState) {
                    this.handleIncomingState(evt, roomId);
                }
            }
            catch (ex) {
                log.error(`Failed to read ban list from ${roomIdOrAlias}`, ex);
            }
        }
        for (const [ircServer, roomIdOrAlias] of Object.entries(this.config.serverBanLists ?? {})) {
            try {
                const roomId = await this.intent.join(roomIdOrAlias);
                this.subscribedRooms.add(roomId);
                this.ircServerBanRooms.set(ircServer, roomId);
                const roomState = await this.intent.roomState(roomId, false) as WeakStateEvent[];
                for (const evt of roomState) {
                    this.handleIncomingState(evt, roomId);
                }
            }
            catch (ex) {
                log.error(`Failed to sync rules for ${ircServer} in ${roomIdOrAlias}:`, ex);
            }
        }
    }

    /**
     * Is the given room considered part of the bridge's ban list set.
     * @param roomId A Matrix room ID.
     * @returns true if state should be handled from the room, false otherwise.
     */
    public isTrackingRoomState(roomId: string): boolean {
        return this.subscribedRooms.has(roomId);
    }

    /**
     * Checks to see if the incoming state is a recommendation entry.
     * @param evt A Matrix state event. Unknown state events will be filtered out.
     * @param roomId The Matrix roomID where the event came from.
     * @returns `true` if the event was a new ban, and existing clients should be checked. `false` otherwise.
     */
    public handleIncomingState(evt: WeakStateEvent, roomId: string) {
        const content = evt.content as unknown as MPolicyContent;
        const entityType = eventTypeToBanEntityType(evt.type);
        if (!entityType) {
            return false;
        }
        const key = `${roomId}:${evt.state_key}`;
        if (evt.content.entity === undefined) {
            // Empty, delete instead.
            log.info(`Deleted ban rule ${evt.type}/$ matching ${key}`);
            this.bannedEntites.delete(key);
            return false;
        }
        if (!supportedRecommendations.includes(content.recommendation)) {
            return false;
        }
        if (typeof content.entity !== "string" || content.entity === "") {
            throw Error('`entity` key is not valid, must be a non-empty string');
        }
        this.bannedEntites.set(key, {
            matcher: new MatrixGlob(content.entity),
            entityType,
            reason: content.reason || "No reason given",
        });
        log.info(`New ban rule ${evt.type} matching ${content.entity}`);
        return true;
    }

    /**
     * Check if a user is banned by via a ban list.
     * @param user A userId string or a MatrixUser object.
     * @returns Either a string reason for the ban, or false if the user was not banned.
     */
    public isUserBanned(user: MatrixUser|string): string|false {
        const matrixUser = typeof user === "string" ? new MatrixUser(user) : user;
        for (const entry of this.bannedEntites.values()) {
            if (entry.entityType === BanEntityType.Server && entry.matcher.test(matrixUser.host)) {
                return entry.reason;
            }
            if (entry.entityType === BanEntityType.User && entry.matcher.test(matrixUser.userId)) {
                return entry.reason;
            }
        }
        return false;
    }

    /**
     * Should be called when the bridge config has been updated.
     * @param config The new config.
     * @param intent The bot user intent.
     */
    // XXX not actually called, ever: hot reloading likely broken
    public async updateConfig(config: MatrixBanSyncConfig) {
        this.config = config;
        await this.syncRules();
    }
}
