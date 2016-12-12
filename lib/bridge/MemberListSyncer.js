/*eslint no-invalid-this: 0*/ // eslint doesn't understand Promise.coroutine wrapping

// Controls the logic for determining which membership lists should be synced and
// handles the sequence of events until the lists are in sync.
"use strict";

var Promise = require("bluebird");
var promiseutil = require("../promiseutil");
var log = require("../logging").get("MemberListSyncer");

function MemberListSyncer(ircBridge, appServiceBot, server, appServiceUserId, injectJoinFn) {
    this.ircBridge = ircBridge;
    this.appServiceBot = appServiceBot;
    this.server = server;
    this.appServiceUserId = appServiceUserId;
    this.injectJoinFn = injectJoinFn;
    this._syncableRoomsPromise = null;
    this._memberLists = {
        matrix: {
            //$roomId : {
            //    id: roomId,
            //    state: stateEvents,
            //    realJoinedUsers: [],
            //    remoteJoinedUsers: []
            //  }
        },
        irc: {
            //$channel : nick[]
        }
    }
}

MemberListSyncer.prototype.sync = Promise.coroutine(function*() {
    let server = this.server;
    if (!server.isMembershipListsEnabled()) {
        log.info("%s does not have membership list syncing enabled.", server.domain);
        return;
    }
    if (!server.shouldSyncMembershipToIrc("initial")) {
        log.info("%s shouldn't sync initial memberships to irc.", server.domain);
        return;
    }
    log.info("Checking membership lists for syncing on %s", server.domain);
    let start = Date.now();
    let rooms = yield this._getSyncableRooms(server);
    log.info("Found %s syncable rooms (%sms)", rooms.length, Date.now() - start);
    this.leaveIrcUsersFromRooms(rooms, server);
    start = Date.now();
    log.info("Joining Matrix users to IRC channels...");
    yield joinMatrixUsersToChannels(rooms, server, this.injectJoinFn);
    log.info("Joined Matrix users to IRC channels. (%sms)", Date.now() - start);
    // NB: We do not need to explicitly join IRC users to Matrix rooms
    // because we get all of the NAMEs/JOINs as events when we connect to
    // the IRC server. This effectively "injects" the list for us.
});

MemberListSyncer.prototype.getChannelsToJoin = Promise.coroutine(function*() {
    let server = this.server;
    log.debug("getChannelsToJoin => %s", server.domain);
    let rooms = yield this._getSyncableRooms(server);

    // map room IDs to channels on this server.
    let channels = new Set();
    let roomInfoMap = {};
    let roomIds = rooms.map((roomInfo) => {
        roomInfoMap[roomInfo.id] = roomInfo;
        return roomInfo.id;
    });
    yield this.ircBridge.getStore().getIrcChannelsForRoomIds(roomIds).then((roomIdToIrcRoom) => {
        Object.keys(roomIdToIrcRoom).forEach((roomId) => {
            // only interested in rooms for this server
            let ircRooms = roomIdToIrcRoom[roomId].filter((ircRoom) => {
                return ircRoom.server.domain === server.domain;
            });
            ircRooms.forEach((ircRoom) => {
                channels.add(ircRoom.channel);
                log.debug(
                    "%s should be joined because %s real Matrix users are in room %s",
                    ircRoom.channel, roomInfoMap[roomId].realJoinedUsers.length, roomId
                );
                if (roomInfoMap[roomId].realJoinedUsers.length < 5) {
                    log.debug("These are: %s", JSON.stringify(roomInfoMap[roomId].realJoinedUsers));
                }
            });
        })
    });

    let channelsArray = Array.from(channels);
    log.debug(
        "getChannelsToJoin => %s should be synced: %s",
        channelsArray.length, JSON.stringify(channelsArray)
    );
    return channelsArray;
});

// map irc channel to a list of room IDs. If all of those
// room IDs have no real users in them, then part the bridge bot too.
MemberListSyncer.prototype.checkBotPartRoom = Promise.coroutine(function*(ircRoom, req) {
    if (ircRoom.channel.indexOf("#") !== 0) {
        return; // don't leave PM rooms
    }
    let matrixRooms = yield this.ircBridge.getStore().getMatrixRoomsForChannel(
        ircRoom.server, ircRoom.channel
    );

    if (matrixRooms.length === 0) {
        // no mapped rooms, leave the channel.
        yield this.ircBridge.partBot(ircRoom);
        return;
    }

    // At least 1 mapped room - query for the membership list in each room. If there are
    // any real users still left in the room, then do not part the bot from the channel.
    // Query via /$room_id/state rather than /initialSync as the latter can cause
    // the bridge to spin for minutes if the response is large.

    let shouldPart = true;
    for (let i = 0; i < matrixRooms.length; i++) {
        let roomId = matrixRooms[i].getId();
        req.log.debug("checkBotPartRoom: Querying room state in room %s", roomId);
        let res = yield this.appServiceBot.getClient().roomState(roomId);
        let data = getRoomMemberData(ircRoom.server, roomId, res, this.appServiceUserId);
        req.log.debug(
            "checkBotPartRoom: %s Matrix users are in room %s", data.reals.length, roomId
        );
        if (data.reals.length > 0) {
            shouldPart = false;
            break;
        }
    }

    if (shouldPart) {
        yield this.ircBridge.partBot(ircRoom);
    }
});

// grab all rooms the bot knows about which have at least 1 real user in them.
// ignoreCache exists because this function hammers /initialSync and that is expeeeensive,
// so we don't do it unless they need absolutely fresh data. On startup, this can be called
// multiple times, so we cache the first request's promise and return that instead of making
// double hits.
//
// returns [
//   {
//       id: roomId,
//       state: stateEvents,
//       realJoinedUsers: [],
//       remoteJoinedUsers: []
//   },
//   ...
// ]
MemberListSyncer.prototype._getSyncableRooms = function(server, ignoreCache) {
    if (!ignoreCache && this._syncableRoomsPromise) {
        log.debug("Returning existing _getSyncableRooms Promise");
        return this._syncableRoomsPromise;
    }

    // hit /initialSync on the bot to pull in room state for all rooms.
    let self = this;
    let fetchRooms = Promise.coroutine(function*() {
        let attempts = 0;
        while (true) { // eslint-disable-line no-constant-condition
            try {
                // roomDict = { room_id: RoomInfo }
                let roomDict = yield self.appServiceBot.getMemberLists();
                return Object.keys(roomDict).map(function(roomId) {
                    return roomDict[roomId];
                }).filter(function(roomInfo) {
                    // filter out rooms with no real matrix users in them.
                    return roomInfo.realJoinedUsers.length > 0;
                });
            }
            catch (err) {
                log.error(
                    `Failed to fetch syncable rooms after ${attempts} attempts: ` + err.stack
                );
                attempts += 1;
                yield Promise.delay(5000); // wait 5s and try again
            }
        }
        log.error("Failed to fetch syncable rooms: Giving up.");
        return [];
    });

    this._syncableRoomsPromise = fetchRooms();
    return this._syncableRoomsPromise;
};

function joinMatrixUsersToChannels(rooms, server, injectJoinFn) {
    var d = promiseutil.defer();

    // filter out rooms listed in the rules
    var filteredRooms = [];
    rooms.forEach(function(roomInfo) {
        if (!server.shouldSyncMembershipToIrc("initial", roomInfo.id)) {
            log.debug(
                "Trimming room %s according to config rules (matrixToIrc=false)",
                roomInfo.id
            );
            if (!roomInfo.realJoinedUsers[0]) {
                return; // no joined users at all
            }
            // trim the list to a single user. We do this rather than filter the
            // room out entirely because otherwise there will be NO matrix users
            // on the IRC-side resulting in no traffic whatsoever.
            roomInfo.realJoinedUsers = [roomInfo.realJoinedUsers[0]];
            log.debug("Trimmed to " + roomInfo.realJoinedUsers);
        }
        filteredRooms.push(roomInfo);
    });

    log.debug("%s rooms passed the config rules", filteredRooms.length);

    // map the filtered rooms to a list of users to join
    // [Room:{reals:[uid,uid]}, ...] => [{uid,roomid}, ...]
    var entries = [];
    filteredRooms.forEach(function(roomInfo) {
        roomInfo.realJoinedUsers.forEach(function(uid, index) {
            entries.push({
                roomId: roomInfo.id,
                userId: uid,
                // Mark the first real matrix user f.e room so we can inject
                // them first to get back up and running more quickly when there
                // is no bot.
                frontier: (index === 0)
            });
        });
    });
    // sort frontier markers to the front of the array
    entries.sort(function(a, b) {
        if (a.frontier && !b.frontier) {
            return -1; // a comes first
        }
        else if (b.frontier && !a.frontier) {
            return 1; // b comes first
        }
        return 0; // don't care
    });

    log.debug("Got %s matrix join events to inject.", entries.length);
    // take the first entry and inject a join event
    function joinNextUser() {
        var entry = entries.shift();
        if (!entry) {
            d.resolve();
            return;
        }
        if (entry.userId.indexOf("@-") === 0) {
            joinNextUser();
            return;
        }
        log.debug(
            "Injecting join event for %s in %s (%s left) is_frontier=%s",
            entry.userId, entry.roomId, entries.length, entry.frontier
        );
        injectJoinFn(entry.roomId, entry.userId, entry.frontier).timeout(
            server.getMemberListFloodDelayMs()
        ).then(() => {
            joinNextUser();
        }, (err) => { // discard error, this will be due to timeouts which we don't want to log
            joinNextUser();
        });
    }

    joinNextUser();

    return d.promise;
}

MemberListSyncer.prototype.leaveIrcUsersFromRooms = function(rooms, server) {
    log.info(
        `leaveIrcUsersFromRooms: storing member list info for ${rooms.length} ` +
        `rooms for server ${server.domain}`
    );

    // Store the matrix room info in memory for later retrieval when NAMES is received
    // and updateIrcMemberList is called. At that point, we have enough information to
    // leave users from the channel that the NAMES is for.
    rooms.forEach((roomInfo) => {
        this._memberLists.matrix[roomInfo.id] = roomInfo;
    });
}

// Update the MemberListSyncer with the IRC NAMES_RPL that has been received for channel.
// This will leave any matrix users that do not have their associated IRC nick in the list
// of names for this channel.
MemberListSyncer.prototype.updateIrcMemberList = Promise.coroutine(function*(channel, names) {
    if (this._memberLists.irc[channel] !== undefined ||
            !this.server.shouldSyncMembershipToMatrix("initial", channel)) {
        return;
    }
    this._memberLists.irc[channel] = Object.keys(names);

    log.info(
        `updateIrcMemberList: Updating IRC member list for ${channel} with ` +
        `${this._memberLists.irc[channel].length} IRC nicks`
    );

    // Convert the IRC channels nicks to userIds
    let ircUserIds = this._memberLists.irc[channel].map(
        (nick) => this.server.getUserIdFromNick(nick)
    );

    // For all bridged rooms, leave users from matrix that are not in the channel
    let roomsForChannel = yield this.ircBridge.getStore().getMatrixRoomsForChannel(
        this.server, channel
    );

    if (roomsForChannel.length === 0) {
        log.info(`updateIrcMemberList: No bridged rooms for channel ${channel}`);
        return;
    }

    // If a userId is in remoteJoinedUsers, but not ircUserIds, intend on leaving roomId
    let promises = [];
    roomsForChannel.forEach((matrixRoom) => {
        let roomId = matrixRoom.getId();
        if (!(
                this._memberLists.matrix[roomId] &&
                this._memberLists.matrix[roomId].remoteJoinedUsers
            )) {
                return;
        }
        this._memberLists.matrix[roomId].remoteJoinedUsers.forEach(
            (userId) => {
                if (ircUserIds.indexOf(userId) === -1) {
                    promises.push(
                        this.ircBridge.getAppServiceBridge().getIntent(userId).leave(roomId)
                    );
                }
            }
        );
    });
    log.info(
        `updateIrcMemberList: Leaving ${promises.length} users as they are not in ${channel}.`
    );
    yield Promise.all(promises);
});

function getRoomMemberData(server, roomId, stateEvents, appServiceUserId) {
    stateEvents = stateEvents || [];
    var data = {
        roomId: roomId,
        virtuals: [],
        reals: []
    };
    stateEvents.forEach(function(event) {
        if (event.type !== "m.room.member" || event.content.membership !== "join") {
            return;
        }
        var userId = event.state_key;
        if (userId === appServiceUserId) {
            return;
        }
        if (server.claimsUserId(userId)) {
            data.virtuals.push(userId);
        }
        else if (userId.indexOf("@-") === 0) {
            // Ignore guest user IDs -- TODO: Do this properly by passing them through
        }
        else {
            data.reals.push(userId);
        }
    });
    return data;
}

module.exports = MemberListSyncer;
