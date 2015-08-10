// Controls the logic for determining which membership lists should be synced and
// handles the sequence of events until the lists are in sync.
"use strict";

var q = require("q");
var matrixToIrc = require("./matrix-to-irc.js");
var ircLib = require("../irclib/irc.js");
var matrixLib = require("../mxlib/matrix");
var MatrixUser = require("../models/users").MatrixUser;
var store = require("../store");
var log = require("../logging").get("membershiplists");

module.exports.sync = function(server) {
    if (!server.isMembershipListsEnabled()) {
        log.info("%s does not have membership list syncing enabled.", server.domain);
        return;
    }
    if (!server.shouldSyncMembershipToIrc("initial")) {
        log.info("%s shouldn't sync initial memberships to irc.", server.domain);
        return;
    }
    log.info("Checking membership lists for syncing on %s", server.domain);
    var start = Date.now();
    var rooms;
    getSyncableRooms(server).then(function(syncRooms) {
        rooms = syncRooms;
        log.info("Found %s syncable rooms (%sms)", rooms.length, Date.now() - start);
        start = Date.now();
        log.info("Joining Matrix users to IRC channels...");
        return joinMatrixUsersToChannels(rooms, server);
    }).then(function() {
        log.info("Joined Matrix users to IRC channels. (%sms)", Date.now() - start);
        // NB: We do not need to explicitly join IRC users to Matrix rooms
        // because we get all of the NAMEs/JOINs as events when we connect to
        // the IRC server. This effectively "injects" the list for us.
        start = Date.now();
        log.info("Leaving IRC users from Matrix rooms (cleanup)...");
        return leaveIrcUsersFromRooms(rooms, server);
    }).done(function() {
        log.info("Left IRC users from Matrix rooms. (%sms)", Date.now() - start);
    }, function(err) {
        log.error("Failed to sync membership lists: %s", err);
    });
};

module.exports.getChannelsToJoin = function(server) {
    log.debug("getChannelsToJoin => %s", server.domain);
    var defer = q.defer();
    // map room IDs to channels on this server.
    getSyncableRooms(server).then(function(rooms) {
        var promises = [];
        var channels = {}; // object for set-like semantics.
        rooms.forEach(function(room) {
            promises.push(store.rooms.getIrcChannelsForRoomId(room.roomId).then(
            function(ircRooms) {
                ircRooms = ircRooms.filter(function(ircRoom) {
                    return ircRoom.server.domain === server.domain;
                });
                ircRooms.forEach(function(ircRoom) {
                    channels[ircRoom.channel] = true;
                    log.debug(
                        "%s should be joined because %s real Matrix users are in room %s",
                        ircRoom.channel, room.reals.length, room.roomId
                    );
                    if (room.reals.length < 5) {
                        log.debug("These are: %s", JSON.stringify(room.reals));
                    }
                });
            }));
        });
        q.allSettled(promises).then(function() {
            var chans = Object.keys(channels);
            log.debug(
                "getChannelsToJoin => %s should be synced: %s",
                chans.length, JSON.stringify(chans)
            );
            defer.resolve(chans);
        });
    });

    return defer.promise;
};


// map irc channel to a list of room IDs. If all of those
// room IDs have no real users in them, then part the bridge bot too.
module.exports.checkBotPartRoom = function(ircRoom, req) {
    if (ircRoom.channel.indexOf("#") !== 0) {
        return; // don't leave PM rooms
    }
    var irc = ircLib.getIrcLibFor(req);
    store.rooms.getMatrixRoomsForChannel(ircRoom.server, ircRoom.channel).done(
    function(matrixRooms) {
        if (matrixRooms.length === 0) {
            // no mapped rooms, leave the channel.
            irc.partBot(ircRoom);
        }
        else if (matrixRooms.length === 1) {
            // common case, just hit /state rather than slow /initialSync
            var roomId = matrixRooms[0].roomId;
            var mxLib = matrixLib.getMatrixLibFor(req);
            mxLib.roomState(roomId).done(function(res) {
                var data = getRoomMemberData(ircRoom.server, roomId, res);
                log.debug(
                    "%s Matrix users are in room %s", data.reals.length, roomId
                );
                if (data.reals.length === 0) {
                    irc.partBot(ircRoom);
                }
            }, function(err) {
                log.error("Failed to hit /state for %s", roomId);
            });
        }
        else {
            // hit initial sync to get list
            getSyncableRooms(ircRoom.server).done(function(syncableRooms) {
                matrixRooms.forEach(function(matrixRoom) {
                    // if the room isn't in the syncable rooms list, then we part.
                    var shouldPart = true;
                    for (var i = 0; i < syncableRooms.length; i++) {
                        if (syncableRooms[i].roomId === matrixRoom.roomId) {
                            shouldPart = false;
                            break;
                        }
                    }
                    if (shouldPart) {
                        irc.partBot(ircRoom);
                    }
                });
            }, function(err) {
                log.error("Failed to hit /initialSync : %s", err);
            });
        }
    }, function(err) {
        log.error(
            "Cannot get matrix rooms for channel %s: %s", ircRoom.channel, err
        );
    });
};

// grab all rooms the bot knows about which have at least 1 real user in them.
function getSyncableRooms(server) {
    var mxLib = matrixLib.getMatrixLibFor();
    var defer = q.defer();
    // hit /initialSync on the bot to pull in room state for all rooms.
    mxLib.initialSync().done(function(res) {
        var rooms = res.rooms || [];
        rooms = rooms.map(function(room) {
            return getRoomMemberData(server, room.room_id, room.state);
        });
        // filter out rooms with no real matrix users in them.
        rooms = rooms.filter(function(room) {
            return room.reals.length > 0;
        });
        defer.resolve(rooms);
    });

    return defer.promise;
}

function joinMatrixUsersToChannels(rooms, server) {
    var d = q.defer();

    // filter out rooms listed in the rules
    var filteredRooms = [];
    rooms.forEach(function(r) {
        if (!server.shouldSyncMembershipToIrc("initial", r.roomId)) {
            log.debug(
                "Skipping room %s according to config rules (matrixToIrc=false)",
                r.roomId
            );
            return;
        }
        filteredRooms.push(r);
    });

    log.debug("%s rooms passed the config rules", filteredRooms.length);

    // map the filtered rooms to a list of users to join
    // [Room:{reals:[uid,uid]}, ...] => [{uid,roomid}, ...]
    var entries = [];
    filteredRooms.forEach(function(r) {
        r.reals.forEach(function(uid) {
            entries.push({
                roomId: r.roomId,
                userId: uid
            });
        });
    });
    log.debug("Got %s matrix join events to inject.", entries.length);
    // pop entries off and join them
    function joinNextUser() {
        var entry = entries.pop();
        if (!entry) {
            d.resolve();
            return;
        }
        log.debug(
            "Injecting join event for %s in %s (%s left)",
            entry.userId, entry.roomId, entries.length
        );
        injectJoinEvent(entry.roomId, entry.userId).finally(function() {
            joinNextUser();
        });
    }

    joinNextUser();

    return d.promise;
}

function leaveIrcUsersFromRooms(rooms, server) {
    return q();
}

function getRoomMemberData(server, roomId, stateEvents) {
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
        if (userId === matrixLib.getAppServiceUserId()) {
            return;
        }
        if (server.claimsUserId(userId)) {
            data.virtuals.push(userId);
        }
        else {
            data.reals.push(userId);
        }
    });
    return data;
}

function injectJoinEvent(roomId, userId) {
    var target = new MatrixUser(userId, null, null);
    return matrixToIrc.onJoin({
        event_id: "$fake:membershiplist",
        room_id: roomId,
        state_key: userId,
        user_id: userId,
        content: {
            membership: "join"
        },
        _injected: true
    }, target);
}
