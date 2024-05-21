import { IrcBridge } from "./IrcBridge";
import { BridgeRequest, BridgeRequestErr } from "../models/BridgeRequest";
import {
    ContentRepo,
    MatrixUser,
    MatrixRoom,
    MembershipQueue,
    StateLookup,
    StateLookupEvent,
    Intent,
} from "matrix-appservice-bridge";
import { IrcUser } from "../models/IrcUser";
import { ActionType, MatrixAction, MatrixMessageEvent } from "../models/MatrixAction";
import { IrcRoom } from "../models/IrcRoom";
import { BridgedClient } from "../irc/BridgedClient";
import { IrcServer } from "../irc/IrcServer";
import { IrcAction } from "../models/IrcAction";
import { toIrcLowerCase } from "../irc/formatting";
import { AdminRoomHandler, parseCommandFromEvent } from "./AdminRoomHandler";
import { trackChannelAndCreateRoom } from "./RoomCreation";
import { renderTemplate } from "../util/Template";
import { trimString } from "../util/TrimString";
import { messageDiff } from "../util/MessageDiff";
import QuickLRU = require("quick-lru");

async function reqHandler(req: BridgeRequest, promise: PromiseLike<unknown>|void) {
    try {
        const res = await promise;
        req.resolve(res);
        return res;
    }
    catch (err) {
        req.reject(err);
        throw err;
    }
}

const MSG_PMS_DISABLED = "[Bridge] Sorry, PMs are disabled on this bridge.";
const MSG_PMS_DISABLED_FEDERATION = "[Bridge] Sorry, PMs are disabled on this bridge over federation.";

const FUNCTIONAL_MEMBERS_EVENT = "io.element.functional_members";

interface FunctionalMembersEventContent {
    service_members: string[];
}

export interface MatrixHandlerConfig {
    /* Number of events to store in memory for use in replies. */
    eventCacheSize: number;
    /* Length of the source text in a formatted reply message */
    replySourceMaxLength: number;
    // How many seconds needs to pass between a message and a reply to it to switch to the long reply format
    shortReplyTresholdSeconds: number;
    // Format of replies sent shortly after the original message
    shortReplyTemplate: string;
    // Format of replies sent a while after the original message
    longReplyTemplate: string;
    // Format of the text explaining why a message is truncated and pastebinned
    truncatedMessageTemplate: string;
    // Ignore io.element.functional_members members joining admin rooms.
    // See https://github.com/vector-im/element-meta/blob/develop/spec/functional_members.md
    ignoreFunctionalMembersInAdminRooms: boolean;
}

export const DEFAULTS: MatrixHandlerConfig = {
    eventCacheSize: 4096,
    replySourceMaxLength: 32,
    shortReplyTresholdSeconds: 5 * 60,
    shortReplyTemplate: "$NICK: $REPLY",
    longReplyTemplate: "<$NICK> \"$ORIGINAL\" <- $REPLY",
    truncatedMessageTemplate: "(full message at <$URL>)",
    ignoreFunctionalMembersInAdminRooms: false,
};

export interface MatrixEventInvite {
    room_id: string;
    state_key: string;
    sender: string;
    content: {
        is_direct?: boolean;
        membership: "invite";
    };
    type: string;
    event_id: string;
}

export interface MatrixEventKick {
    room_id: string;
    sender: string;
    state_key: string;
    content: {
        reason?: string;
        membership: "leave";
    };
    type: string;
    event_id: string;
}

export interface MatrixSimpleMessage {
    sender: string;
    event_id: string;
    content: {
        body: string;
    };
}

interface MatrixEventLeave {
    room_id: string;
    event_id: string;
    _injected?: boolean;
}

export interface OnMemberEventData {
    _frontier?: boolean;
    _injected?: boolean;
    room_id: string;
    state_key: string;
    type: string;
    event_id: string;
    origin_server_ts?: number;
    content: {
        displayname?: string;
        membership: string;
    };
}

interface CachedEvent {
    body: string;
    sender: string;
    timestamp: number;
}

export class MatrixHandler {
    // maintain a list of room IDs which are being processed invite-wise. This is
    // required because invites are processed asyncly, so you could get invite->msg
    // and the message is processed before the room is created.
    private readonly processingInvitesForRooms: {
        [roomIdUserId: string]: Promise<unknown>;
    } = {};
    // Map of `roomId-eventId` -> cached event
    private readonly eventCache: Map<string, CachedEvent> = new Map();
    private readonly metrics: {[domain: string]: {
            [metricName: string]: number;
        };} = {};
    private readonly mediaUrl: string;
    private memberTracker?: StateLookup;
    private adminHandler: AdminRoomHandler;
    private config: MatrixHandlerConfig = DEFAULTS;

    private memberJoinDefaultTs = Date.now();
    private memberJoinTs = new QuickLRU<string, number>({
        maxSize: 8192,
    });

    constructor(
        private readonly ircBridge: IrcBridge,
        config: MatrixHandlerConfig|undefined,
        private readonly membershipQueue: MembershipQueue
    ) {
        this.onConfigChanged(config);

        // The media URL to use to transform mxc:// URLs when handling m.room.[file|image]s
        this.mediaUrl = ircBridge.config.homeserver.media_url || ircBridge.config.homeserver.url;
        this.adminHandler = new AdminRoomHandler(ircBridge, this);
    }

    public initialise() {
        this.memberTracker = new StateLookup({
            intent: this.ircBridge.getAppServiceBridge().getIntent(),
            eventTypes: ['m.room.member']
        });
    }

    // ===== Matrix Invite Handling =====

    /**
     * Process a Matrix invite event for an Admin room.
     * @param {Object} event : The Matrix invite event.
     * @param {Request} req : The request for this event.
     * @param {MatrixUser} inviter : The user who invited the bot.
     */
    private async handleAdminRoomInvite(req: BridgeRequest, event: {room_id: string}, inviter: MatrixUser) {
        req.log.info(`Handling invite from ${inviter.getId()} directed to bot.`);
        // Real MX user inviting BOT to a private chat
        const mxRoom = new MatrixRoom(event.room_id);
        await this.membershipQueue.join(event.room_id, undefined, req, true);

        // Do not create an admin room if the room is marked as 'plumbed'
        const matrixClient = this.ircBridge.getAppServiceBridge().getIntent();
        const plumbedState = await matrixClient.getStateEvent(event.room_id, 'm.room.plumbing', '', true);
        if (plumbedState?.status === "enabled") {
            req.log.info(
                'This room is marked for plumbing (m.room.plumbing.status = "enabled"). ' +
                'Not treating room as admin room.'
            );
            return;
        }

        // clobber any previous admin room ID
        await this.ircBridge.getStore().storeAdminRoom(mxRoom, inviter.userId);
    }

    /**
     * Process a Matrix invite event for an Admin room.
     * @param {Object} event : The Matrix invite event.
     * @param {Request} req : The request for this event.
     * @param {IrcUser} invitedIrcUser : The IRC user the bot invited to a room.
     */
    private async handleInviteFromBot(req: BridgeRequest, event: {room_id: string}, invitedIrcUser: IrcUser) {
        req.log.info("Handling invite from bot directed at %s on %s",
            invitedIrcUser.server.domain, invitedIrcUser.nick);
        // Bot inviting VMX to a matrix room which is mapped to IRC. Just make a
        // matrix user and join the room (we trust the bot, so no additional checks)
        const mxUser = await this.ircBridge.getMatrixUser(invitedIrcUser);
        await this.membershipQueue.join(event.room_id, mxUser.getId(), req, true);
    }

    private async handleInviteFromUser(req: BridgeRequest, event: MatrixEventInvite, invited: IrcUser) {
        req.log.info("Handling invite from user directed at %s on %s",
            invited.nick, invited.server.domain);
        const invitedUser = await this.ircBridge.getMatrixUser(invited);
        const mxRoom = new MatrixRoom(event.room_id);
        const intent = this.ircBridge.getAppServiceBridge().getIntent(invitedUser.getId());
        const mxUser = new MatrixUser(event.sender);
        // Real MX user inviting VMX to a matrix room for PM chat
        if (!invited.server.allowsPms()) {
            req.log.error("Accepting invite, and then leaving: This server does not allow PMs.");
            await intent.join(event.room_id);
            await this.ircBridge.sendMatrixAction(mxRoom, invitedUser, new MatrixAction(
                ActionType.Notice,
                MSG_PMS_DISABLED
            ));
            await intent.leave(event.room_id);
            return;
        }

        // If no federated PMs are allowed, check the origin of the PM
        //  is same the domain as the bridge
        if (!invited.server.shouldFederatePMs()) {
            // Matches for the local part (the not-user part)
            if (mxUser.host !== this.ircBridge.domain) {
                req.log.error(
                    "Accepting invite, and then leaving: This server does not allow federated PMs."
                );
                await intent.join(event.room_id);
                await this.ircBridge.sendMatrixAction(mxRoom, invitedUser, new MatrixAction(
                    ActionType.Notice,
                    MSG_PMS_DISABLED_FEDERATION
                ));
                await intent.leave(event.room_id);
                return;
            }
        }
        // create a virtual Matrix user for the IRC user

        await this.membershipQueue.join(event.room_id, invitedUser.getId(), req, true);
        req.log.info("Joined %s to room %s", invitedUser.getId(), event.room_id);

        // check if this room is a PM room or not.
        const isPmRoom = event.content.is_direct === true;

        if (isPmRoom) {
            // nick is the channel
            const ircRoom = new IrcRoom(invited.server, invited.nick);
            await this.ircBridge.getStore().setPmRoom(
                ircRoom, mxRoom, event.sender, event.state_key
            );
            return;
        }
        req.log.warn(`Room ${event.room_id} is not a 1:1 chat`);
        await intent.kick(event.room_id, invitedUser.getId(), "Group chat not supported.");
    }

    // === Admin room handling ===
    private async onAdminMessage(req: BridgeRequest, event: MatrixSimpleMessage,
                                 adminRoom: MatrixRoom): Promise<void> {
        req.log.info("Received admin message from %s", event.sender);

        const botUser = new MatrixUser(this.ircBridge.appServiceUserId, undefined, false);

        // First call begins tracking, subsequent calls do nothing
        await this.memberTracker?.trackRoom(adminRoom.getId());
        const members = ((this.memberTracker?.getState(
            adminRoom.getId(),
            "m.room.member",
        ) || []) as Array<StateLookupEvent>).filter((m) =>
            (m.content as {membership: string}).membership === "join"
        );

        let functionalMembers = this.config.ignoreFunctionalMembersInAdminRooms &&
            ((
                this.memberTracker?.getState(adminRoom.getId(), FUNCTIONAL_MEMBERS_EVENT, "") as StateLookupEvent|null
            )?.content as FunctionalMembersEventContent)?.service_members || [];

        if (!Array.isArray(functionalMembers)) {
            // Guard against invalid types.
            functionalMembers = [];
        }

        // If an admin room has more than 2 people in it, kick the bot out
        if (members.filter(m => !functionalMembers.includes(m.state_key)).length > 2) {
            req.log.error(
                `onAdminMessage: admin room has ${members.length}` +
                ` users instead of just 2; bot will leave`
            );

            // Notify users in admin room
            const notice = new MatrixAction(ActionType.Notice,
                "There are more than 2 users in this admin room"
            );
            await this.ircBridge.sendMatrixAction(adminRoom, botUser, notice);

            await this.ircBridge.getAppServiceBridge().getIntent(
                botUser.getId()
            ).leave(adminRoom.getId());
            return;
        }

        await this.adminHandler.onAdminMessage(req, event, adminRoom);
        return;
    }

    public async quitUser(req: BridgeRequest, userId: string, clientList: BridgedClient[],
                          ircServer: IrcServer|null, reason: string) {
        let clients = clientList;
        if (ircServer) {
            // Filter to get the clients for the [specified] server
            clients = clientList.filter(
                (bridgedClient) => bridgedClient.server.domain === ircServer.domain
            );
        }
        if (clients.length === 0) {
            req.log.info(`No bridgedClients for ${userId}`);
            return "You are not connected to any networks.";
        }

        const intent = this.ircBridge.getAppServiceBridge().getIntent();

        for (const bridgedClient of clients) {
            req.log.info(
                `Killing bridgedClient (nick = ${bridgedClient.nick}) for ${bridgedClient.userId}`
            );
            if (!bridgedClient.server.config.ircClients.kickOn.userQuit) {
                req.log.info(
                    `Not leaving ${userId} from rooms on ${bridgedClient.server.domain}`
                );
                await bridgedClient.kill(reason);
                continue;
            }

            if (bridgedClient.chanList.size === 0) {
                req.log.info(
                    `Bridged client for ${userId} is not in any channels ` +
                    `on ${bridgedClient.server.domain}`
                );
            }
            else {
                // Get all rooms that the bridgedClient is in
                const uniqueRoomIds = new Set<string>();
                (await Promise.all(
                    [...bridgedClient.chanList].map(
                        (channel) => {
                            return this.ircBridge.getStore().getMatrixRoomsForChannel(
                                bridgedClient.server, channel
                            );
                        }
                    )
                    // flatten to a single unqiue set
                )).forEach((rSet) => rSet.forEach((r) => uniqueRoomIds.add(r.getId())));

                // Don't wait for these to complete
                Promise.all([...uniqueRoomIds].map(async (roomId) => {
                    let state: {membership?: string};
                    try {
                        state = await intent.getStateEvent(roomId, "m.room.member", userId);
                    }
                    catch (ex) {
                        state = {};
                    }
                    try {
                        // Only kick if the state is join or leave, ignore all else.
                        // https://github.com/matrix-org/matrix-appservice-irc/issues/1163
                        if (state.membership === "join" || state.membership === "invite" ) {
                            await this.membershipQueue.leave(
                                roomId,
                                userId,
                                req,
                                false,
                                reason,
                                this.ircBridge.appServiceUserId
                            );
                        }
                    }
                    catch (err) {
                        req.log.error(err);
                        req.log.warn(
                            `Could not kick ${bridgedClient.userId} ` +
                            `from bridged room ${roomId}: ${err.message}`
                        );
                    }
                }));
            }

            // The success message will effectively be 'Your connection to ... has been lost.`
            await bridgedClient.kill(reason);
        }

        return null;
    }

    /**
     * Called when the AS receives a new Matrix invite/join/leave event.
     * @param {Object} event : The Matrix member event.
     */
    private _onMemberEvent(req: BridgeRequest, event: OnMemberEventData) {
        if (event.content.membership === 'join') {
            this.memberJoinTs.set(`${event.room_id}/${event.state_key}`, Date.now());
        }
        else {
            this.memberJoinTs.delete(`${event.room_id}/${event.state_key}`);
        }
        this.memberTracker?.onEvent(event);
    }

    /**
     * Called when a Matrix user tries to invite another user into a PM
     * @param {Object} event : The Matrix invite event.
     * @param {MatrixUser} inviter : The inviter (sender).
     * @param {MatrixUser} invitee : The invitee (receiver).
     * @return {Promise} which is resolved/rejected when the request finishes.
     */
    private async handleInviteToPMRoom(req: BridgeRequest, event: MatrixEventInvite,
                                       inviter: MatrixUser, invitee: MatrixUser): Promise<BridgeRequestErr|null> {
        // We don't support this
        req.log.warn(
            `User ${inviter.getId()} tried to invite ${invitee.getId()} to a PM room. Disconnecting from room`
        );
        const store = this.ircBridge.getStore();
        const [room] = await store.getIrcChannelsForRoomId(event.room_id);
        await store.removePmRoom(event.room_id);
        const userId = room.server.getUserIdFromNick(room.channel);
        const intent = this.ircBridge.getAppServiceBridge().getIntent(userId);
        await intent.sendMessage(event.room_id, {
            msgtype: "m.notice",
            body: "This room has been disconnected from IRC. You cannot invite new users into a IRC PM. " +
                  "Please create a new PM room.",
        });
        await intent.leave(event.room_id);
        return null;
    }

    /**
     * Called when the AS receives a new Matrix invite event.
     * @param {Object} event : The Matrix invite event.
     * @param {MatrixUser} inviter : The inviter (sender).
     * @param {MatrixUser} invitee : The invitee (receiver).
     * @return {Promise} which is resolved/rejected when the request finishes.
     */
    private async _onInvite(req: BridgeRequest, event: MatrixEventInvite, inviter: MatrixUser, invitee: MatrixUser):
    Promise<BridgeRequestErr|null> {
        /*
        * (MX=Matrix user, VMX=Virtual matrix user, BOT=AS bot)
        * Valid invite flows:
        * [1] MX  --invite--> VMX  (starting a PM chat)
        * [2] bot --invite--> VMX  (invite-only room that the bot is in who is inviting virtuals)
        * [3] MX  --invite--> BOT  (admin room; auth)
        * [4] bot --invite--> MX   (bot telling real mx user IRC conn state) - Ignore.
        * [5] irc --invite--> MX   (real irc user PMing a Matrix user) - Ignore.
        * [6] MX  --invite--> BOT  (invite to private room to allow bot to bridge) - Ignore.
        * [7] MX  --invite--> MX   (matrix user inviting another matrix user)
        */
        req.log.info("onInvite: from=%s to=%s rm=%s id=%s", event.sender,
            event.state_key, event.room_id, event.event_id);
        this._onMemberEvent(req, event);

        // mark this room as being processed in case we simultaneously get
        // messages for this room (which would fail if we haven't done the
        // invite yet!)
        this.processingInvitesForRooms[event.room_id + event.state_key] = req.getPromise();
        req.getPromise().finally(() => {
            delete this.processingInvitesForRooms[event.room_id + event.state_key];
        });

        // Check if this room is known to us.
        const rooms = await this.ircBridge.getStore().getIrcChannelsForRoomId(event.room_id);
        const hasExistingRoom= rooms.length > 1;

        const inviteeIsVirtual = !!this.ircBridge.getServerForUserId(event.state_key);
        const inviterIsVirtual = !!this.ircBridge.getServerForUserId(event.sender);

        // work out which flow we're dealing with and fork off asap
        // is the invitee the bot?
        if (this.ircBridge.appServiceUserId === event.state_key) {
            if (event.content.is_direct && !hasExistingRoom) {
                // case [3]
                // This is a PM invite to the bot.
                await this.handleAdminRoomInvite(req, event, inviter);
            }
            // case[6]
            // Drop through so the invite stays active, but do not join the room.
        }
        else if (!inviterIsVirtual && rooms[0]?.getType() === "pm") {
            // case[7]-pms
            return this.handleInviteToPMRoom(req, event, inviter, invitee);
        } // case[7]-groups falls through.
        // else is the invitee a real matrix user? If they are, there will be no IRC server
        else if (!inviteeIsVirtual) {
            // If this is a PM, we need to disconnect it
            // cases [4], [5]: We cannot accept on behalf of real matrix users, so nop
            return BridgeRequestErr.ERR_NOT_MAPPED;
        }
        else {
            // cases [1] and [2] : The invitee represents a real IRC user
            const ircUser = await this.ircBridge.matrixToIrcUser(invitee);
            // is the invite from the bot?
            if (this.ircBridge.appServiceUserId === event.sender) {
                await this.handleInviteFromBot(req, event, ircUser); // case [2]
            }
            else { // We check if this is an invite inside the func.
                await this.handleInviteFromUser(req, event, ircUser); // case [1]
            }
        }
        return null;
    }

    private async _onJoin(req: BridgeRequest, event: OnMemberEventData, user: MatrixUser):
    Promise<BridgeRequestErr|null> {
        req.log.info("onJoin: usr=%s rm=%s id=%s", event.state_key, event.room_id, event.event_id);
        this._onMemberEvent(req, event);
        // membershiplists injects leave events when syncing initial membership
        // lists. We know if this event is injected because this flag is set.
        const syncKind = event._injected ? "initial" : "incremental";
        const promises: Promise<unknown>[] = []; // one for each join request

        if (this.ircBridge.appServiceUserId === user.getId()) {
            // ignore messages from the bot
            return BridgeRequestErr.ERR_VIRTUAL_USER;
        }

        // is this a tracked channel?
        let ircRooms = await this.ircBridge.getStore().getIrcChannelsForRoomId(event.room_id);

        // =========== Bridge Bot Joining ===========
        // Make sure the bot is joining on all mapped IRC channels
        ircRooms.forEach((ircRoom) => {
            this.ircBridge.joinBot(ircRoom);
        });

        // =========== Client Joining ===========
        // filter out rooms which don't mirror matrix join parts and are NOT frontier
        // entries. Frontier entries must ALWAYS be joined else the IRC channel will
        // not be bridged!
        ircRooms = ircRooms.filter((room) => {
            return room.server.shouldSyncMembershipToIrc(
                syncKind, event.room_id
            ) || event._frontier;
        });

        if (ircRooms.length === 0) {
            req.log.info(
                "No tracked channels which mirror joins for this room."
            );
            return BridgeRequestErr.ERR_NOT_MAPPED;
        }

        // for each room (which may be on different servers)
        ircRooms.forEach((room) => {
            if (room.server.claimsUserId(user.getId())) {
                req.log.debug("%s is a virtual user (claimed by %s)",
                    user.getId(), room.server.domain);
                return;
            }
            // get the virtual IRC user for this user
            promises.push((async () => {
                let bridgedClient: BridgedClient|null = null;
                try {
                    bridgedClient = await this.ircBridge.getBridgedClient(
                        room.server, user.getId(), (event.content || {}).displayname
                    );
                }
                catch (e) {
                    req.log.info(`${user.getId()} failed to get a IRC connection.`, e);
                    if (room.server.config.ircClients.kickOn.ircConnectionFailure) {
                        // We need to kick on failure to get a client.
                        req.log.info(`Kicking from room`);
                        this.incrementMetric(room.server.domain, "connection_failure_kicks");
                        const excluded = room.server.isExcludedUser(user.getId());
                        await this.membershipQueue.leave(
                            event.room_id,
                            user.getId(),
                            req,
                            true,
                            excluded && excluded.kickReason || `IRC connection failure.`,
                            this.ircBridge.appServiceUserId,
                        );
                    }
                    else {
                        req.log.info(`Not kicking - disabled in config`);
                    }
                }

                if (!bridgedClient || !bridgedClient.userId) {
                    // For types, drop out early if we don't have a bridgedClient
                    return;
                }

                // Check for a displayname change and update nick accordingly.
                if (event.content &&
                    event.content.displayname &&
                    event.content.displayname !== bridgedClient.displayName) {
                    bridgedClient.displayName = event.content.displayname;
                    // Changing the nick requires that:
                    // - the server allows nick changes
                    // - the nick is not custom
                    const config = await this.ircBridge.getStore().getIrcClientConfig(
                        bridgedClient.userId, room.server.domain
                    );
                    if (config && room.server.allowsNickChanges() &&
                        !config.getDesiredNick()
                    ) {
                        const intent = this.ircBridge.getAppServiceBridge().getIntent();
                        // Check that the /profile matches the displayname.
                        const userProfile = await intent.getProfileInfo(event.state_key, "displayname");
                        // We only want to update the nickname if the profile contains the displayname
                        if (userProfile.displayname === event.content.displayname) {
                            try {
                                const newNick = room.server.getNick(
                                    bridgedClient.userId, event.content.displayname
                                );
                                bridgedClient.changeNick(newNick, false);
                            }
                            catch (e) {
                                req.log.warn(`Didn't change nick on the IRC side: ${e}`);
                            }
                        }
                    }
                }

                await bridgedClient.joinChannel(room.channel); // join each channel
            })());
        });

        // We know ircRooms.length > 1. The only time when this isn't mapped into a Promise
        // is when there is a virtual user: TODO: clean this up! Control flow is hard.
        if (promises.length === 0) {
            return BridgeRequestErr.ERR_VIRTUAL_USER;
        }

        await Promise.all(promises);
        return null;
    }

    private async _onKick(req: BridgeRequest, event: MatrixEventKick, kicker: MatrixUser, kickee: MatrixUser) {
        req.log.info(
            "onKick %s is kicking/banning %s from %s (reason: %s)",
            kicker.getId(), kickee.getId(), event.room_id, event.content.reason || "none"
        );
        this._onMemberEvent(req, event);

        /*
        We know this is a Matrix client kicking someone.
        There are 2 scenarios to consider here:
        - Matrix on Matrix kicking
        - Matrix on IRC kicking

        Matrix-Matrix
        =============
        __USER A____            ____USER B___
        |            |          |             |
        Matrix     vIRC1       Matrix        vIRC2 |     Effect
        -----------------------------------------------------------------------
        Kicker                 Kickee              |  vIRC2 parts channel.
                                                    This avoids potential permission issues
                                                    in case vIRC1 cannot kick vIRC2 on IRC.

        Matrix-IRC
        ==========
        __USER A____            ____USER B___
        |            |          |             |
        Matrix      vIRC        IRC       vMatrix  |     Effect
        -----------------------------------------------------------------------
        Kicker                            Kickee   |  vIRC tries to kick IRC via KICK command.
        */

        const ircRooms = await this.ircBridge.getStore().getIrcChannelsForRoomId(event.room_id);
        // do we have an active connection for the kickee? This tells us if they are real
        // or virtual.
        const kickeeClients = this.ircBridge.getBridgedClientsForUserId(kickee.getId());

        if (kickeeClients.length === 0) {
            // Matrix on IRC kicking, work out which IRC user to kick.
            let server = null;
            for (let i = 0; i < ircRooms.length; i++) {
                if (ircRooms[i].server.claimsUserId(kickee.getId())) {
                    server = ircRooms[i].server;
                    break;
                }
            }
            if (!server) {
                return; // kicking a bogus user
            }
            const kickeeNick = server.getNickFromUserId(kickee.getId());
            if (!kickeeNick) {
                return; // bogus virtual user ID
            }
            // work out which client will do the kicking
            const kickerClient = this.ircBridge.getIrcUserFromCache(server, kicker.getId());
            if (!kickerClient) {
                // well this is awkward.. whine about it and bail.
                req.log.warn(
                    "%s has no client instance to send kick from. Cannot kick.",
                    kicker.getId()
                );
                return;
            }
            // we may be bridging this matrix room into many different IRC channels, and we want
            // to kick this user from all of them.
            for (let i = 0; i < ircRooms.length; i++) {
                if (ircRooms[i].server.domain !== server.domain) {
                    return;
                }
                kickerClient.kick(
                    kickeeNick, ircRooms[i].channel,
                    `Kicked by ${kicker.getId()}` +
                    (event.content.reason ? ` : ${event.content.reason}` : "")
                );
            }
        }
        else {
            // Matrix on Matrix kicking: part the channel.
            const kickeeServerLookup: {[serverDomain: string]: BridgedClient} = {};
            kickeeClients.forEach((ircClient) => {
                kickeeServerLookup[ircClient.server.domain] = ircClient;
            });
            await Promise.all(ircRooms.map((async (ircRoom) => {
                // Make the connected IRC client leave the channel.
                const client = kickeeServerLookup[ircRoom.server.domain];
                if (!client) {
                    return; // not connected to this server
                }
                // If we aren't joined this will no-op.
                await client.leaveChannel(
                    ircRoom.channel,
                    `Kicked by ${kicker.getId()} ` +
                    (event.content.reason ? ` : ${event.content.reason}` : "")
                );
            })));
        }
    }

    private async _onLeave(req: BridgeRequest, event: MatrixEventLeave, user: MatrixUser):
    Promise<BridgeRequestErr|null> {
        req.log.info("onLeave: usr=%s rm=%s id=%s", user.getId(), event.room_id, event.event_id);
        // membershiplists injects leave events when syncing initial membership
        // lists. We know if this event is injected because this flag is set.
        const syncKind = event._injected ? "initial" : "incremental";

        if (this.ircBridge.appServiceUserId === user.getId()) {
            // ignore messages from the bot
            return BridgeRequestErr.ERR_VIRTUAL_USER;
        }

        // do we have an active connection for this user?
        let clientList = this.ircBridge.getBridgedClientsForUserId(user.getId());
        // filter out servers which don't mirror matrix join parts (unless it's a kick)
        clientList = clientList.filter((client) => {
            return (
                client.server.shouldSyncMembershipToIrc(syncKind, event.room_id) &&
                !client.server.claimsUserId(user.getId())
            ); // not a virtual user
        });

        const serverLookup: {[serverDomain: string]: BridgedClient} = {};
        clientList.forEach((ircClient) => {
            serverLookup[ircClient.server.domain] = ircClient;
        });

        const store = this.ircBridge.getStore();

        // which channels should the connected client leave?
        const ircRooms = await store.getIrcChannelsForRoomId(event.room_id);

        if (!ircRooms) {
            const adminRoom = await store.getAdminRoomById(event.room_id);
            if (adminRoom) {
                await store.removeAdminRoom(adminRoom);
                // The user left the admin room, let's also leave.
                // XXX: The typing of .leave is wrong, it should
                // allow undefined.
                await this.membershipQueue.leave(event.room_id, "", req);
                return null;
            }

            const pmRoom = await store.getMatrixPmRoomById(event.room_id);
            if (pmRoom) {
                await store.removePmRoom(pmRoom.roomId);
                // The user left the pm room, let's also leave.
                const members = await this.ircBridge.getAppServiceBridge().getBot().getJoinedMembers(pmRoom.roomId);
                await Promise.all(Object.keys(members).map((u) => {
                    this.membershipQueue.leave(event.room_id, u, req);
                }));
                return null;
            }

        }

        // ========== Client Parting ==========
        // for each room, if we're connected to it, leave the channel.
        const promises = ircRooms.map(async (ircRoom) => {
            // Make the connected IRC client leave the channel.
            const client = serverLookup[ircRoom.server.domain];
            if (!client) {
                return; // not connected to this server
            }
            // leave it; if we aren't joined this will no-op.
            await client.leaveChannel(ircRoom.channel);
        });

        if (promises.length === 0) { // no connected clients
            return BridgeRequestErr.ERR_VIRTUAL_USER;
        }

        // =========== Bridge Bot Parting ===========
        // For membership list syncing only
        await Promise.all(ircRooms.map(async (ircRoom) => {
            const client = serverLookup[ircRoom.server.domain];
            if (!client) {
                return; // no client left the room, so no need to recheck part room.
            }
            if (!ircRoom.server.isBotEnabled()) {
                return; // don't do expensive queries needlessly
            }
            if (!ircRoom.server.shouldJoinChannelsIfNoUsers()) {
                if (ircRoom.server.domain) {
                    // this = IrcBridge
                    await this.ircBridge.getMemberListSyncer(ircRoom.server).checkBotPartRoom(
                        ircRoom, req
                    );
                }
            }
        }));
        await Promise.all(promises);
        return null;
    }

    private async onCommand(req: BridgeRequest, event: MatrixMessageEvent): Promise<BridgeRequestErr|null> {
        req.log.info(`Handling in-room command from ${event.sender}`);
        const parseResult = parseCommandFromEvent(event, "!irc ");
        if (!parseResult) {
            throw Error('Cannot handle malformed command');
        }
        const intent = this.ircBridge.getAppServiceBridge().getIntent();
        const { cmd: command, args } = parseResult;
        // We currently only check the first room.
        const [targetRoom] = await this.ircBridge.getStore().getIrcChannelsForRoomId(event.room_id);
        if (command === "nick") {
            const newNick = args[0];
            if (!(newNick?.length > 0)) {
                await intent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: "You must specify a valid nickname",
                });
                return BridgeRequestErr.ERR_DROPPED;
            }
            // We need to get the context of this room.
            if (!targetRoom) {
                await intent.sendMessage(event.room_id, {
                    'msgtype': 'm.notice',
                    'body': 'Room is not bridged, cannot set nick without a target server'
                });
                return BridgeRequestErr.ERR_NOT_MAPPED;
            }
            const bridgedClient = await this.ircBridge.getBridgedClient(targetRoom.server, event.sender);
            req.log.info("Matrix user wants to change nick from %s to %s", bridgedClient.nick, newNick);
            try {
                await bridgedClient.changeNick(newNick, true);
            }
            catch (e) {
                await intent.sendMessage(event.room_id, {
                    'msgtype': 'm.notice',
                    'body': `Unable to change nick: ${e.message}`
                });
                req.log.warn(`Didn't change nick on the IRC side: ${e}`);
            }
            return null;
        }
        await intent.sendMessage(event.room_id, {
            'msgtype': 'm.notice',
            'body': 'Command not known'
        });
        return null;
    }

    /**
     * Called when the AS receives a new Matrix Event.
     * @return {Promise} which is resolved/rejected when the request finishes.
     */
    private async _onMessage(req: BridgeRequest, event: MatrixMessageEvent): Promise<BridgeRequestErr|null> {
        /*
        * Valid message flows:
        * Matrix --> IRC (Bridged communication)
        * Matrix --> Matrix (Admin room)
        */

        req.log.info("onMessage: %s usr=%s rm=%s id=%s",
            event.type, event.sender, event.room_id, event.event_id
        );
        if (event.content.body) {
            req.log.debug("Message body: %s", event.content.body);
        }

        const mxAction = MatrixAction.fromEvent(
            event, this.mediaUrl
        );

        // check if this message is from one of our virtual users
        const servers = this.ircBridge.getServers();
        for (let i = 0; i < servers.length; i++) {
            if (servers[i].claimsUserId(event.sender)) {
                req.log.debug("%s is a virtual user (claimed by %s)",
                    event.sender, servers[i].domain);
                return BridgeRequestErr.ERR_VIRTUAL_USER;
            }
        }


        if (mxAction.type === "command") {
            return this.onCommand(req, event);
        }

        const ircAction = IrcAction.fromMatrixAction(mxAction);
        if (ircAction === null) {
            req.log.info("IrcAction couldn't determine an action type.");
            return BridgeRequestErr.ERR_DROPPED;
        }

        // wait a while if we just got an invite else we may not have the mapping stored
        // yet...
        const key = `${event.room_id}+${event.sender}`;
        if (key in this.processingInvitesForRooms) {
            req.log.info(
                "Holding request for %s until invite for room %s is done.",
                event.sender, event.room_id
            );
            await this.processingInvitesForRooms[key];
            req.log.info(
                "Finished holding event for %s in room %s", event.sender, event.room_id
            );
        }

        if (this.ircBridge.appServiceUserId === event.sender) {
            // ignore messages from the bot
            return BridgeRequestErr.ERR_VIRTUAL_USER;
        }


        const ircRooms = await this.ircBridge.getStore().getIrcChannelsForRoomId(event.room_id);

        // Sometimes bridge's message each other and get stuck in a silly loop. Ensure it's m.text
        if (ircRooms.length === 0 && event.content && event.content.msgtype === "m.text") {
            // This is used to ensure type safety.
            const body = event.content.body;
            if (!body?.trim().length) {
                return BridgeRequestErr.ERR_DROPPED;
            }
            // could be an Admin room, so check.
            const adminRoom = await this.ircBridge.getStore().getAdminRoomById(event.room_id);
            if (!adminRoom) {
                req.log.debug("No mapped channels.");
                return BridgeRequestErr.ERR_DROPPED;
            }
            // process admin request
            await this.onAdminMessage(req, { ...event, content: { body }}, adminRoom);
        }


        // Check for other matrix rooms which are bridged to this channel.
        // If there are other rooms, send this message directly to that room as the virtual matrix user.
        // E.g: send this message to MROOM2 and MROOM3:
        //
        // MROOM1            MROOM2             MROOM3
        //   |                 |                  |
        //   +->>MSG>>----------------------------+
        //                 |                  |
        //                #chan              #chan2
        //
        const otherMatrixRoomIdsToServers = Object.create(null);
        const messageSendPromiseSet: Promise<unknown>[] = [];
        const fetchRoomsPromiseSet: Promise<unknown>[] = [];

        ircRooms.forEach((ircRoom) => {
            if (ircRoom.server.claimsUserId(event.sender)) {
                req.log.debug("%s is a virtual user (claimed by %s)",
                    event.sender, ircRoom.server.domain);
                return;
            }
            req.log.info("Relaying message in %s on %s",
                ircRoom.channel, ircRoom.server.domain);

            if (ircRoom.getType() === "channel") {
                fetchRoomsPromiseSet.push((async () => {
                    const otherMatrixRooms = await this.ircBridge.getStore().getMatrixRoomsForChannel(
                        ircRoom.server, ircRoom.channel
                    );
                    otherMatrixRooms.forEach((mxRoom) => {
                        otherMatrixRoomIdsToServers[mxRoom.getId()] = ircRoom.server;
                    });
                })());
            }

            // If we already have a cached client then yay, but if we
            // don't then we need to hit out for their display name in
            // this room.
            let bridgedClient = this.ircBridge.getIrcUserFromCache(ircRoom.server, event.sender);
            if (!bridgedClient) {
                messageSendPromiseSet.push((async () => {
                    const intent = this.ircBridge.getAppServiceBridge().getIntent();
                    const displayName = await intent.getStateEvent(
                        event.room_id, "m.room.member", event.sender
                    ).catch(err => {
                        req.log.warn(`Failed to get display name for the room: ${err}`);
                        return intent.getProfileInfo(event.sender, "displayname");
                    }).then(
                        res => res.displayname
                    ).catch(err => {
                        req.log.error(`Failed to get display name: ${err}`);
                    });
                    bridgedClient = await this.ircBridge.getBridgedClient(
                        ircRoom.server, event.sender, displayName
                    );
                    await this.sendIrcAction(req, ircRoom, bridgedClient, ircAction, event);
                })());
            }
            else {
                // push each request so we don't block processing other rooms
                messageSendPromiseSet.push(
                    this.sendIrcAction(req, ircRoom, bridgedClient, ircAction, event),
                );
            }
        });
        await Promise.all(fetchRoomsPromiseSet);
        Object.keys(otherMatrixRoomIdsToServers).forEach((roomId) => {
            if (roomId === event.room_id) {
                return; // don't bounce back to the sender
            }
            const otherServer = otherMatrixRoomIdsToServers[roomId];
            // convert the sender's user ID to a nick and back to a virtual user for this server
            // then send from that user ID (yuck!).
            const n = otherServer.getNick(event.sender);
            const virtUserId = otherServer.getUserIdFromNick(n);
            messageSendPromiseSet.push(
                this.ircBridge.sendMatrixAction(
                    new MatrixRoom(roomId), new MatrixUser(virtUserId), mxAction
                )
            );
        });

        await Promise.all(messageSendPromiseSet);
        return null;
    }

    private async sendIrcAction(req: BridgeRequest, ircRoom: IrcRoom, ircClient: BridgedClient, ircAction: IrcAction,
                                event: MatrixMessageEvent) {
        // Send the action as is if it is not a text message
        if (!["m.text", "m.notice"].find(msgtype => msgtype === event.content.msgtype) || !event.content.body) {
            await this.ircBridge.sendIrcAction(ircRoom, ircClient, ircAction);
            return;
        }

        let cacheBody = ircAction.text;

        // special handling for replies (and threads)
        if (event.content["m.relates_to"] && event.content["m.relates_to"]["m.in_reply_to"]) {
            const eventId = event.content["m.relates_to"]["m.in_reply_to"].event_id;
            const reply = await this.textForReplyEvent(req, event, eventId, ircRoom);
            if (reply !== null) {
                ircAction.text = reply.formatted;
                cacheBody = reply.reply;
            }
        }

        // special handling for edits
        if (event.content["m.relates_to"]?.rel_type === "m.replace") {
            const originalEventId = event.content["m.relates_to"].event_id;
            let originalBody = this.getCachedEvent(event.room_id, originalEventId)?.body;
            if (!originalBody) {
                try {
                    // FIXME: this will return the new event rather than the original one
                    // to actually see the original content we'd need to use whatever
                    // https://github.com/matrix-org/matrix-doc/pull/2675 stabilizes on
                    let intent: Intent;
                    if (ircRoom.getType() === "pm") {
                        // no Matrix Bot, use the IRC user's intent
                        const userId = ircRoom.server.getUserIdFromNick(ircRoom.channel);
                        intent = this.ircBridge.getAppServiceBridge().getIntent(userId);
                    }
                    else {
                        intent = this.ircBridge.getAppServiceBridge().getIntent();
                    }
                    const eventContent = await intent.getEvent(
                        event.room_id, originalEventId
                    );
                    originalBody = eventContent.content.body;
                }
                catch (_err) {
                    req.log.warn("Couldn't find an event being edited, using fallback text");
                }
            }
            const newBody = event.content["m.new_content"]?.body;
            if (originalBody && newBody) {
                const diff = messageDiff(originalBody, newBody);
                if (diff) {
                    ircAction.text = diff;
                }
            }
        }

        let body = cacheBody.trim().substring(0, this.config.replySourceMaxLength);
        const nextNewLine = body.indexOf("\n");
        if (nextNewLine !== -1) {
            body = body.substring(0, nextNewLine);
        }
        // Cache events in here so we can refer to them for replies.
        this.cacheEvent(
            event.room_id,
            event.event_id,
            {
                body: cacheBody,
                sender: event.sender,
                timestamp: event.origin_server_ts,
            },
        );

        // The client might still be connected, for abundance of safety let's wait.
        await ircClient.waitForConnected();

        // Generate an array of individual messages that would be sent
        const potentialMessages = ircClient.getSplitMessages(ircRoom.channel, ircAction.text);
        const roomLineLimit = await this.ircBridge.roomConfigs.getLineLimit(event.room_id, ircRoom);
        const lineLimit = roomLineLimit === null ? ircRoom.server.getLineLimit() : roomLineLimit;

        if (potentialMessages.length <= lineLimit) {
            await this.ircBridge.sendIrcAction(ircRoom, ircClient, ircAction);
            return;
        }

        // Message body too long, upload to HS instead

        // Use the current ISO datetime as the name of the file
        //  strip off milliseconds and replace 'T' with an underscore
        //  result e.g : 2016-08-03T10:40:48.620Z becomes 2016-08-03_10:40:48
        let fileName = new Date().toISOString()
            .split(/[T|\.]/)
            .splice(0, 2)
            .join('_') + '.txt';

        // somenick_2016-08-03_10:40:48.txt
        fileName = ircClient.nick + '_' + fileName;

        let contentUri: string|null = null;

        try {
            // Try to upload as a file and get URI
            //  (this could fail, see the catch statement)
            contentUri = await this.ircBridge.uploadTextFile(fileName, ircAction.text);
        }
        catch (err) {
            // Uploading the file to HS could fail
            req.log.error("Failed to upload text file ", err);
        }

        // This is true if the upload was a success
        if (contentUri) {
            const httpUrl = ContentRepo.getHttpUriForMxc(this.mediaUrl, contentUri);
            // we check event.content.body since ircAction already has the markers stripped
            const codeBlockMatch = event.content.body.match(/^```(\w+)?/);
            if (codeBlockMatch) {
                const type = codeBlockMatch[1] ? ` ${codeBlockMatch[1]}` : '';
                event.content = {
                    msgtype: "m.emote",
                    body:    `sent a${type} code block: ${httpUrl}`
                };
            }
            else {
                const explanation = renderTemplate(this.config.truncatedMessageTemplate, { url: httpUrl });
                let messagePreview = trimString(
                    potentialMessages[0],
                    ircClient.getMaxLineLength() - 4 /* "... " */ - explanation.length - ircRoom.channel.length
                );
                if (potentialMessages.length > 1 || messagePreview.length < potentialMessages[0].length) {
                    messagePreview += '...';
                }

                event.content = {
                    ...event.content,
                    body: `${messagePreview} ${explanation}`,
                };
            }

            const truncatedIrcAction = IrcAction.fromMatrixAction(
                MatrixAction.fromEvent(event, this.mediaUrl)
            );
            if (truncatedIrcAction) {
                await this.ircBridge.sendIrcAction(ircRoom, ircClient, truncatedIrcAction);
            }
        }
        else {
            req.log.debug("Sending truncated message");
            // Modify the event to become a truncated version of the original
            //  the truncation limits the number of lines sent to lineLimit.

            const msg = '\n...(truncated)';

            const sendingEvent: MatrixMessageEvent = { ...event,
                content: {
                    ...event.content,
                    body: potentialMessages.splice(0, lineLimit - 1).join('\n') + msg
                }
            };

            // Recreate action from modified event
            const truncatedIrcAction = IrcAction.fromMatrixAction(
                MatrixAction.fromEvent(
                    sendingEvent,
                    this.mediaUrl,
                )
            );
            if (truncatedIrcAction) {
                await this.ircBridge.sendIrcAction(ircRoom, ircClient, truncatedIrcAction);
            }
        }
    }

    /**
     * Called when the AS receives an alias query from the HS.
     * @param {string} roomAlias : The room alias queried.
     * @return {Promise} which is resolved/rejected when the request finishes.
     */
    private async _onAliasQuery(req: BridgeRequest, roomAlias: string) {
        req.log.info("onAliasQuery %s", roomAlias);

        // check if alias maps to a valid IRC server and channel
        const channelInfo = this.ircBridge.aliasToIrcChannel(roomAlias);
        if (!channelInfo.channel) {
            throw new Error("Unknown alias: " + roomAlias); // bad alias
        }
        if (!channelInfo.server.createsPublicAliases()) {
            throw new Error("This server does not allow alias mappings.");
        }
        req.log.info("Mapped to %s on %s",
            channelInfo.channel, channelInfo.server.domain
        );

        // See if we are already tracking this channel (case-insensitive
        // channels but case-sensitive aliases)
        const matrixRooms = await this.ircBridge.getStore().getMatrixRoomsForChannel(
            channelInfo.server, channelInfo.channel
        );
        if (matrixRooms.length === 0) {
            await trackChannelAndCreateRoom(this.ircBridge, req, {
                server: channelInfo.server,
                // lower case the name to join (there's a bug in the IRC lib
                // where the join callback never fires if you try to join
                // #WithCaps in channels :/)
                ircChannel:  toIrcLowerCase(channelInfo.channel),
                roomAliasName: roomAlias.split(":")[0].substring(1), // localpart
                origin: "alias",
            })
        }
        else {
            // create an alias pointing to this room (take first)
            // TODO: Take first with public join_rules
            const roomId = matrixRooms[0].getId();
            req.log.info("Pointing alias %s to %s", roomAlias, roomId);
            await this.ircBridge.getAppServiceBridge().getIntent().createAlias(
                roomAlias, roomId
            );
        }
    }

    /**
     * Called when the AS receives a user query from the HS.
     * @param {string} userId : The user ID queried.
     * @return {Promise} which is resolved/rejected when the request finishes.
     */
    private async _onUserQuery(req: BridgeRequest, userId: string) {
        if (this.ircBridge.appServiceUserId === userId) {
            return;
        }
        req.log.info("onUserQuery: %s", userId);
        const matrixUser = new MatrixUser(userId);
        const ircUser = await this.ircBridge.matrixToIrcUser(matrixUser);
        await this.ircBridge.getMatrixUser(ircUser);
    }

    private async textForReplyEvent(
        req: BridgeRequest, event: MatrixMessageEvent, replyEventId: string, ircRoom: IrcRoom
    ): Promise<{formatted: string; reply: string}|null> {
        const bridgeIntent = this.ircBridge.getAppServiceBridge().getIntent();
        // strips out the quotation of the original message, if needed
        const replyText = (body: string): string => {
            const REPLY_REGEX = /> <(.*?)>(.*?)\n\n([\s\S]*)/;
            const match = REPLY_REGEX.exec(body);
            if (match === null || match.length !== 4) {
                return body;
            }
            return match[3];
        };

        const REPLY_NAME_MAX_LENGTH = 12;
        if (!event.content.body) {
            return null;
        }

        const rplText = replyText(event.content.body);
        let rplName: string;
        let rplSource: string;
        // Reply must be in the same room as the original event.
        let cachedEvent = this.getCachedEvent(event.room_id, replyEventId);
        if (!cachedEvent) {
            // Fallback to fetching from the homeserver.
            try {
                const eventContent = await bridgeIntent.getEvent(
                    event.room_id, replyEventId
                );
                rplName = eventContent.sender;
                if (typeof(eventContent.content.body) !== "string") {
                    throw Error("'body' was not a string.");
                }
                const isReply = eventContent.content["m.relates_to"] &&
                    eventContent.content["m.relates_to"]["m.in_reply_to"];
                if (isReply) {
                    rplSource = replyText(eventContent.content.body);
                }
                else {
                    rplSource = eventContent.content.body;
                }
                cachedEvent = {sender: rplName, body: rplSource, timestamp: eventContent.origin_server_ts};
                this.cacheEvent(eventContent.room_id, eventContent.event_id, cachedEvent);
            }
            catch (err) {
                // If we couldn't find the event, then frankly we can't
                // trust it and we won't treat it as a reply.
                return {
                    formatted: rplText,
                    reply: rplText,
                };
            }
        }
        else {
            rplName = cachedEvent.sender;
            rplSource = cachedEvent.body;
        }

        const senderJoinTs = this.memberJoinTs.get(`${event.room_id}/${event.sender}`) ?? this.memberJoinDefaultTs;
        if (senderJoinTs > cachedEvent.timestamp) {
            // User joined AFTER the event was sent (or left and joined, but we can't distinguish that).
            // Do not treat as a reply.
            req.log.warn(`User ${event.sender} attempted to reply to an event before they were joined`);
            return {
                formatted: rplText,
                reply: rplText,
            };
        }

        // Get the first non-blank line from the source.
        const lines = rplSource.split('\n').filter((line) => !/^\s*$/.test(line))
        if (lines.length > 0) {
            rplSource = trimString(lines[0], this.config.replySourceMaxLength);

            // Ellipsis if needed.
            if (lines.length > 1 || rplSource.length < lines[0].length) {
                rplSource = rplSource + "...";
            }
        }
        else {
            // Don't show a source because we couldn't format one.
            rplSource = "";
        }

        // Fetch the sender's IRC nick.
        const sourceClient = this.ircBridge.getIrcUserFromCache(ircRoom.server, rplName);
        if (sourceClient) {
            rplName = sourceClient.nick;
        }
        else {
            // If we couldn't find a client for them, they might be a ghost.
            const ghostName = ircRoom.getServer().getNickFromUserId(rplName);
            // If we failed to get a name, just make a guess of it.
            rplName = ghostName !== null ? ghostName : rplName.substring(1,
                1 + Math.min(REPLY_NAME_MAX_LENGTH, rplName.indexOf(":") - 1)
            );
        }

        let replyTemplate: string;
        const thresholdMs = (this.config.shortReplyTresholdSeconds) * 1000;
        if (rplSource && event.origin_server_ts - cachedEvent.timestamp > thresholdMs) {
            replyTemplate = this.config.longReplyTemplate;
        }
        else {
            replyTemplate = this.config.shortReplyTemplate;
        }

        const formattedReply = renderTemplate(replyTemplate, {
            nick: rplName,
            original: rplSource,
            reply: rplText,
        });
        return {
            formatted: formattedReply,
            reply: rplText,
        };
    }

    private incrementMetric(serverDomain: string, metricName: string) {
        let metricSet = this.metrics[serverDomain];
        if (!metricSet) {
            metricSet = this.metrics[serverDomain] = {};
        }
        if (metricSet[metricName] === undefined) {
            metricSet[metricName] = 1;
        }
        else {
            metricSet[metricName]++;
        }
        this.metrics[serverDomain] = metricSet;
    }

    private cacheEvent(roomId: string, eventId: string, event: CachedEvent) {
        const cacheKey = `${roomId}-${eventId}`;
        this.eventCache.set(cacheKey, event);

        if (this.eventCache.size > this.config.eventCacheSize) {
            const delKey = this.eventCache.entries().next().value[0];
            this.eventCache.delete(delKey);
        }
    }

    private getCachedEvent(roomId: string, eventId: string): CachedEvent|undefined {
        const cacheKey = `${roomId}-${eventId}`;
        return this.eventCache.get(cacheKey);
    }

    // EXPORTS
    public onConfigChanged(config: MatrixHandlerConfig|undefined) {
        this.config = {...DEFAULTS, ...config};
    }

    public onMemberEvent(req: BridgeRequest, event: OnMemberEventData) {
        return reqHandler(req, this._onMemberEvent(req, event));
    }

    public onInvite(req: BridgeRequest, event: MatrixEventInvite, inviter: MatrixUser, invitee: MatrixUser) {
        return reqHandler(req, this._onInvite(req, event, inviter, invitee));
    }

    public onJoin(req: BridgeRequest, event: OnMemberEventData, user: MatrixUser) {
        return reqHandler(req, this._onJoin(req, event, user));
    }

    public onLeave(req: BridgeRequest, event: MatrixEventLeave, user: MatrixUser) {
        return reqHandler(req, this._onLeave(req, event, user));
    }

    public onKick(req: BridgeRequest, event: MatrixEventKick, kicker: MatrixUser, kickee: MatrixUser) {
        return reqHandler(req, this._onKick(req, event, kicker, kickee));
    }

    public onMessage(req: BridgeRequest, event: MatrixMessageEvent) {
        return reqHandler(req, this._onMessage(req, event));
    }

    public onAliasQuery(req: BridgeRequest, alias: string) {
        return reqHandler(req, this._onAliasQuery(req, alias));
    }

    public onUserQuery(req: BridgeRequest, userId: string) {
        return reqHandler(req, this._onUserQuery(req, userId))
    }

    public getMetrics(serverDomain: string) {
        const metrics = this.metrics[serverDomain] || {};
        this.metrics[serverDomain] = {}
        return metrics || {};
    }
}
