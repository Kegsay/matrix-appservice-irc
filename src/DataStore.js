/*eslint no-invalid-this: 0*/ // eslint doesn't understand Promise.coroutine wrapping
"use strict";

var Promise = require("bluebird");
var crypto = require('crypto');

var MatrixRoom = require("matrix-appservice-bridge").MatrixRoom;
var MatrixUser = require("matrix-appservice-bridge").MatrixUser;
var RemoteUser = require("matrix-appservice-bridge").RemoteUser;
var IrcRoom = require("./models/IrcRoom");
var IrcClientConfig = require("./models/IrcClientConfig");
var log = require("./logging").get("DataStore");
var fs = require('fs');

function DataStore(userStore, roomStore, pkeyPath, bridgeDomain) {
    this._roomStore = roomStore;
    this._userStore = userStore;
    this._serverMappings = {}; // { domain: IrcServer }
    this._bridgeDomain = bridgeDomain;

    var errLog = function(fieldName) {
        return function(err) {
            if (err) {
                log.error("Failed to ensure '%s' index on store: " + err, fieldName);
                return;
            }
            log.info("Indexes checked on '%s' for store.", fieldName);
        };
    };

    // add some indexes
    this._roomStore.db.ensureIndex({
        fieldName: "id",
        unique: true,
        sparse: false
    }, errLog("id"));
    this._roomStore.db.ensureIndex({
        fieldName: "matrix_id",
        unique: false,
        sparse: true
    }, errLog("matrix_id"));
    this._roomStore.db.ensureIndex({
        fieldName: "remote_id",
        unique: false,
        sparse: true
    }, errLog("remote_id"));
    this._userStore.db.ensureIndex({
        fieldName: "data.localpart",
        unique: false,
        sparse: true
    }, errLog("localpart"));
    this._userStore.db.ensureIndex({
        fieldName: "id",
        unique: true,
        sparse: false
    }, errLog("user id"));

    this._privateKey = null;

    if (pkeyPath) {
        try {
            this._privateKey = fs.readFileSync(pkeyPath, "utf8").toString();

            // Test whether key is a valid PEM key (publicEncrypt does internal validation)
            try {
                crypto.publicEncrypt(
                    this._privateKey,
                    new Buffer("This is a test!")
                );
            }
            catch (err) {
                log.error(`Failed to validate private key: (${err.message})`);
                throw err;
            }

            log.info(`Private key loaded from ${pkeyPath} - IRC password encryption enabled.`);
        }
        catch (err) {
            log.error(`Could not load private key ${err.message}.`);
            throw err;
        }
    }

    // Cache as many mappings as possible for hot paths like message sending.

    // TODO: cache IRC channel -> [room_id] mapping (only need to remove them in
    //       removeRoom() which is infrequent)
    // TODO: cache room_id -> [#channel] mapping (only need to remove them in
    //       removeRoom() which is infrequent)

}

DataStore.prototype.setServerFromConfig = Promise.coroutine(function*(server, serverConfig) {
    this._serverMappings[server.domain] = server;

    var channels = Object.keys(serverConfig.mappings);
    for (var i = 0; i < channels.length; i++) {
        var channel = channels[i];
        for (var k = 0; k < serverConfig.mappings[channel].length; k++) {
            var ircRoom = new IrcRoom(server, channel);
            var mxRoom = new MatrixRoom(
                serverConfig.mappings[channel][k]
            );
            yield this.storeRoom(ircRoom, mxRoom, 'config');
        }
    }

    // Some kinds of users may have the same user_id prefix so will cause ident code to hit
    // getMatrixUserByUsername hundreds of times which can be slow:
    // https://github.com/matrix-org/matrix-appservice-irc/issues/404
    let domainKey = server.domain.replace(/\./g, "_");
    this._userStore.db.ensureIndex({
        fieldName: "data.client_config." + domainKey + ".username",
        unique: true,
        sparse: true
    }, function(err) {
        if (err) {
            log.error("Failed to ensure ident username index on users database!");
            return;
        }
        log.info("Indexes checked for ident username for " + server.domain + " on users database");
    });
});

/**
 * Persists an IRC <--> Matrix room mapping in the database.
 * @param {IrcRoom} ircRoom : The IRC room to store.
 * @param {MatrixRoom} matrixRoom : The Matrix room to store.
 * @param {string} origin : "config" if this mapping is from the config yaml,
 * "provision" if this mapping was provisioned, "alias" if it was created via
 * aliasing and "join" if it was created during a join.
 * @return {Promise}
 */
DataStore.prototype.storeRoom = function(ircRoom, matrixRoom, origin) {
    if (typeof origin !== 'string') {
        throw new Error('Origin must be a string = "config"|"provision"|"alias"|"join"');
    }

    log.info("storeRoom (id=%s, addr=%s, chan=%s, origin=%s)",
        matrixRoom.getId(), ircRoom.get("domain"), ircRoom.channel, origin);

    let mappingId = createMappingId(matrixRoom.getId(), ircRoom.get("domain"), ircRoom.channel);
    return this._roomStore.linkRooms(matrixRoom, ircRoom, {
        origin: origin
    }, mappingId);
};

/**
 * Get an IRC <--> Matrix room mapping from the database.
 * @param {string} roomId : The Matrix room ID.
 * @param {string} ircDomain : The IRC server domain.
 * @param {string} ircChannel : The IRC channel.
 * @param {string} origin : (Optional) "config" if this mapping was from the config yaml,
 * "provision" if this mapping was provisioned, "alias" if it was created via aliasing and
 * "join" if it was created during a join.
 * @return {Promise} A promise which resolves to a room entry, or null if one is not found.
 */
DataStore.prototype.getRoom = function(roomId, ircDomain, ircChannel, origin) {
    if (typeof origin !== 'undefined' && typeof origin !== 'string') {
        throw new Error(`If defined, origin must be a string =
            "config"|"provision"|"alias"|"join"`);
    }
    let mappingId = createMappingId(roomId, ircDomain, ircChannel);

    return this._roomStore.getEntryById(mappingId).then(
        (entry) => {
            if (origin && entry && origin !== entry.data.origin) {
                return null;
            }
            return entry;
        });
};

/**
 * Get all Matrix <--> IRC room mappings from the database.
 * @return {Promise} A promise which resolves to a map:
 *      $roomId => [{networkId: 'server #channel1', channel: '#channel2'} , ...]
 */
DataStore.prototype.getAllChannelMappings = Promise.coroutine(function*() {
    let entries = yield this._roomStore.select(
        {
            matrix_id: {$exists: true},
            remote_id: {$exists: true},
            'remote.type': "channel"
        }
    );

    let mappings = {};

    entries.forEach((e) => {
        // drop unknown irc networks in the database
        if (!this._serverMappings[e.remote.domain]) {
            return;
        }
        if (!mappings[e.matrix_id]) {
            mappings[e.matrix_id] = [];
        }
        mappings[e.matrix_id].push({
            networkId: this._serverMappings[e.remote.domain].getNetworkId(),
            channel: e.remote.channel
        });
    });

    return mappings;
});

/**
 * Get provisioned IRC <--> Matrix room mappings from the database where
 * the matrix room ID is roomId.
 * @param {string} roomId : The Matrix room ID.
 * @return {Promise} A promise which resolves to a list
 * of entries.
 */
DataStore.prototype.getProvisionedMappings = function(roomId) {
    return this._roomStore.getEntriesByMatrixId(roomId).filter(
        (entry) => {
            return entry.data && entry.data.origin === 'provision'
        });
};

/**
 * Remove an IRC <--> Matrix room mapping from the database.
 * @param {string} roomId : The Matrix room ID.
 * @param {string} ircDomain : The IRC server domain.
 * @param {string} ircChannel : The IRC channel.
 * @param {string} origin : "config" if this mapping was from the config yaml,
 * "provision" if this mapping was provisioned, "alias" if it was created via
 * aliasing and "join" if it was created during a join.
 * @return {Promise}
 */
DataStore.prototype.removeRoom = function(roomId, ircDomain, ircChannel, origin) {
    if (typeof origin !== 'string') {
        throw new Error('Origin must be a string = "config"|"provision"|"alias"|"join"');
    }

    return this._roomStore.delete({
        id: createMappingId(roomId, ircDomain, ircChannel),
        'data.origin': origin
    });
};

/**
 * Retrieve a list of IRC rooms for a given room ID.
 * @param {string} roomId : The room ID to get mapped IRC channels.
 * @return {Promise<Array<IrcRoom>>} A promise which resolves to a list of
 * rooms.
 */
DataStore.prototype.getIrcChannelsForRoomId = function(roomId) {
    return this._roomStore.getLinkedRemoteRooms(roomId).then((remoteRooms) => {
        return remoteRooms.filter((remoteRoom) => {
            return Boolean(this._serverMappings[remoteRoom.get("domain")]);
        }).map((remoteRoom) => {
            let server = this._serverMappings[remoteRoom.get("domain")];
            return IrcRoom.fromRemoteRoom(server, remoteRoom);
        });
    });
};

/**
 * Retrieve a list of IRC rooms for a given list of room IDs. This is significantly
 * faster than calling getIrcChannelsForRoomId for each room ID.
 * @param {string[]} roomIds : The room IDs to get mapped IRC channels.
 * @return {Promise<Map<string, IrcRoom[]>>} A promise which resolves to a map of
 * room ID to an array of IRC rooms.
 */
DataStore.prototype.getIrcChannelsForRoomIds = function(roomIds) {
    return this._roomStore.batchGetLinkedRemoteRooms(roomIds).then((roomIdToRemoteRooms) => {
        Object.keys(roomIdToRemoteRooms).forEach((roomId) => {
            // filter out rooms with unknown IRC servers and
            // map RemoteRooms to IrcRooms
            roomIdToRemoteRooms[roomId] = roomIdToRemoteRooms[roomId].filter((remoteRoom) => {
                return Boolean(this._serverMappings[remoteRoom.get("domain")]);
            }).map((remoteRoom) => {
                let server = this._serverMappings[remoteRoom.get("domain")];
                return IrcRoom.fromRemoteRoom(server, remoteRoom);
            });
        });
        return roomIdToRemoteRooms;
    });
};

/**
 * Retrieve a list of Matrix rooms for a given server and channel.
 * @param {IrcServer} server : The server to get rooms for.
 * @param {string} channel : The channel to get mapped rooms for.
 * @return {Promise<Array<MatrixRoom>>} A promise which resolves to a list of rooms.
 */
DataStore.prototype.getMatrixRoomsForChannel = function(server, channel) {
    var ircRoom = new IrcRoom(server, channel);
    return this._roomStore.getLinkedMatrixRooms(
        IrcRoom.createId(ircRoom.getServer(), ircRoom.getChannel())
    );
};

DataStore.prototype.getMappingsForChannelByOrigin = function(server, channel, origin, allowUnset) {
    if (typeof origin === "string") {
        origin = [origin];
    }
    if (!Array.isArray(origin) || !origin.every((s) => typeof s === "string")) {
        throw new Error("origin must be string or array of strings");
    }
    let remoteId = IrcRoom.createId(server, channel);
    return this._roomStore.getEntriesByRemoteId(remoteId).then((entries) => {
        return entries.filter((e) => {
            if (allowUnset) {
                if (!e.data || !e.data.origin) {
                    return true;
                }
            }
            return e.data && origin.indexOf(e.data.origin) !== -1;
        });
    });
};

DataStore.prototype.getModesForChannel = function (server, channel) {
    log.info("getModesForChannel (server=%s, channel=%s)",
        server.domain, channel
    );
    let remoteId = IrcRoom.createId(server, channel);
    return this._roomStore.getEntriesByRemoteId(remoteId).then((entries) => {
        const mapping = {};
        entries.forEach((entry) => {
            mapping[entry.matrix.getId()] = entry.remote.get("modes") || [];
        });
        return mapping;
    });
};

DataStore.prototype.setModeForRoom = Promise.coroutine(function*(roomId, mode, enabled=True) {
    log.info("setModeForRoom (mode=%s, roomId=%s, enabled=%s)",
        mode, roomId, enabled
    );
    return this._roomStore.getEntriesByMatrixId(roomId).then((entries) => {
        entries.map((entry) => {
            const modes = entry.remote.get("modes") || [];
            const hasMode = modes.includes(mode);

            if (hasMode === enabled) {
                return;
            }
            if (enabled) {
                modes.push(mode);
            }
            else {
                modes.splice(modes.indexOf(mode), 1);
            }

            entry.remote.set("modes", modes);

            this._roomStore.upsertEntry(entry);
        });
    });
});

DataStore.prototype.setPmRoom = function(ircRoom, matrixRoom, userId, virtualUserId) {
    log.info("setPmRoom (id=%s, addr=%s chan=%s real=%s virt=%s)",
        matrixRoom.getId(), ircRoom.server.domain, ircRoom.channel, userId,
        virtualUserId);

    return this._roomStore.linkRooms(matrixRoom, ircRoom, {
        real_user_id: userId,
        virtual_user_id: virtualUserId
    }, createPmId(userId, virtualUserId));
};

DataStore.prototype.getMatrixPmRoom = function(realUserId, virtualUserId) {
    var id = createPmId(realUserId, virtualUserId);
    return this._roomStore.getEntryById(id).then(function(entry) {
        if (!entry) {
            return null;
        }
        return entry.matrix;
    });
};

DataStore.prototype.getTrackedChannelsForServer = function(ircAddr) {
    return this._roomStore.getEntriesByRemoteRoomData({ domain: ircAddr }).then(
    (entries) => {
        var channels = [];
        entries.forEach((e) => {
            let r = e.remote;
            let server = this._serverMappings[r.get("domain")];
            if (!server) {
                return;
            }
            let ircRoom = IrcRoom.fromRemoteRoom(server, r);
            if (ircRoom.getType() === "channel") {
                channels.push(ircRoom.getChannel());
            }
        });
        return channels;
    });
};

DataStore.prototype.getRoomIdsFromConfig = function() {
    return this._roomStore.getEntriesByLinkData({
        origin: 'config'
    }).then(function(entries) {
        return entries.map((e) => {
            return e.matrix.getId();
        });
    });
};

DataStore.prototype.removeConfigMappings = function() {
    return this._roomStore.removeEntriesByLinkData({
        from_config: true // for backwards compatibility
    }).then(() => {
        return this._roomStore.removeEntriesByLinkData({
            origin: 'config'
        })
    });
};

DataStore.prototype.getIpv6Counter = Promise.coroutine(function*() {
    let config = yield this._userStore.getRemoteUser("config");
    if (!config) {
        config = new RemoteUser("config");
        config.set("ipv6_counter", 0);
        yield this._userStore.setRemoteUser(config);
    }
    return config.get("ipv6_counter");
});

DataStore.prototype.setIpv6Counter = Promise.coroutine(function*(counter) {
    let config = yield this._userStore.getRemoteUser("config");
    if (!config) {
        config = new RemoteUser("config");
    }
    config.set("ipv6_counter", counter);
    yield this._userStore.setRemoteUser(config);
});

/**
 * Retrieve a stored admin room based on the room's ID.
 * @param {String} roomId : The room ID of the admin room.
 * @return {Promise} Resolved when the room is retrieved.
 */
DataStore.prototype.getAdminRoomById = function(roomId) {
    return this._roomStore.getEntriesByMatrixId(roomId).then(function(entries) {
        if (entries.length == 0) {
            return null;
        }
        if (entries.length > 1) {
            log.error("getAdminRoomById(" + roomId + ") has " + entries.length + " entries");
        }
        if (entries[0].matrix.get("admin_id")) {
            return entries[0].matrix;
        }
        return null;
    });
};

/**
 * Stores a unique admin room for a given user ID.
 * @param {MatrixRoom} room : The matrix room which is the admin room for this user.
 * @param {String} userId : The user ID who is getting an admin room.
 * @return {Promise} Resolved when the room is stored.
 */
DataStore.prototype.storeAdminRoom = function(room, userId) {
    log.info("storeAdminRoom (id=%s, user_id=%s)", room.getId(), userId);
    room.set("admin_id", userId);
    return this._roomStore.upsertEntry({
        id: createAdminId(userId),
        matrix: room,
    });
};

DataStore.prototype.upsertRoomStoreEntry = function(entry) {
    return this._roomStore.upsertEntry(entry);
}

DataStore.prototype.getAdminRoomByUserId = function(userId) {
    return this._roomStore.getEntryById(createAdminId(userId)).then(function(entry) {
        if (!entry) {
            return null;
        }
        return entry.matrix;
    });
};

DataStore.prototype.storeMatrixUser = function(matrixUser) {
    return this._userStore.setMatrixUser(matrixUser);
};

DataStore.prototype.getMatrixUserByLocalpart = function(localpart) {
    return this._userStore.getMatrixUser(`@${localpart}:${this._bridgeDomain}`);
};

DataStore.prototype.getIrcClientConfig = function(userId, domain) {
    return this._userStore.getMatrixUser(userId).then((matrixUser) => {
        if (!matrixUser) {
            return null;
        }
        var userConfig = matrixUser.get("client_config");
        if (!userConfig) {
            return null;
        }
        // map back from _ to .
        Object.keys(userConfig).forEach(function(domainWithUnderscores) {
            let actualDomain = domainWithUnderscores.replace(/_/g, ".");
            if (actualDomain !== domainWithUnderscores) { // false for 'localhost'
                userConfig[actualDomain] = userConfig[domainWithUnderscores];
                delete userConfig[domainWithUnderscores];
            }
        })
        var configData = userConfig[domain];
        if (!configData) {
            return null;
        }
        let clientConfig = new IrcClientConfig(userId, domain, configData);
        if (clientConfig.getPassword()) {
            if (!this._privateKey) {
                throw new Error(`Cannot decrypt password of ${userId} - no private key`);
            }
            let decryptedPass = crypto.privateDecrypt(
                this._privateKey,
                new Buffer(clientConfig.getPassword(), 'base64')
            ).toString();
            // Extract the password by removing the prefixed salt and seperating space
            decryptedPass = decryptedPass.split(' ')[1];
            clientConfig.setPassword(decryptedPass);
        }
        return clientConfig;
    });
};

DataStore.prototype.storeIrcClientConfig = function(config) {
    return this._userStore.getMatrixUser(config.getUserId()).then((user) => {
        if (!user) {
            user = new MatrixUser(config.getUserId(), undefined, false);
        }
        var userConfig = user.get("client_config") || {};
        if (config.getPassword()) {
            if (!this._privateKey) {
                throw new Error(
                    'Cannot store plaintext passwords'
                );
            }
            let salt = crypto.randomBytes(16).toString('base64');
            let encryptedPass = crypto.publicEncrypt(
                this._privateKey,
                new Buffer(salt + ' ' + config.getPassword())
            ).toString('base64');
            // Store the encrypted password, ready for the db
            config.setPassword(encryptedPass);
        }
        userConfig[config.getDomain().replace(/\./g, "_")] = config.serialize();
        user.set("client_config", userConfig);
        return this._userStore.setMatrixUser(user);
    });
};

DataStore.prototype.getUserFeatures = function(userId) {
    return this._userStore.getMatrixUser(userId).then((matrixUser) => {
        return matrixUser ? (matrixUser.get("features") || {}) : {};
    });
};

DataStore.prototype.storeUserFeatures = function(userId, features) {
    return this._userStore.getMatrixUser(userId).then((matrixUser) => {
        if (!matrixUser) {
            matrixUser = new MatrixUser(userId, undefined, false);
        }
        matrixUser.set("features", features);
        return this._userStore.setMatrixUser(matrixUser);
    });
};

DataStore.prototype.storePass = Promise.coroutine(
    function*(userId, domain, pass) {
        let config = yield this.getIrcClientConfig(userId, domain);
        if (!config) {
            throw new Error(`${userId} does not have an IRC client configured for ${domain}`);
        }
        config.setPassword(pass);
        yield this.storeIrcClientConfig(config);
    }
);

DataStore.prototype.removePass = Promise.coroutine(
    function*(userId, domain) {
        let config = yield this.getIrcClientConfig(userId, domain);
        config.setPassword(undefined);
        yield this.storeIrcClientConfig(config);
    }
);

DataStore.prototype.getMatrixUserByUsername = Promise.coroutine(
function*(domain, username) {
    let domainKey = domain.replace(/\./g, "_");
    let matrixUsers = yield this._userStore.getByMatrixData({
        ["client_config." + domainKey + ".username"]: username
    });

    if (matrixUsers.length > 1) {
        log.error(
            "getMatrixUserByUsername return %s results for %s on %s",
            matrixUsers.length, username, domain
        );
    }
    return matrixUsers[0];
});

function createPmId(userId, virtualUserId) {
    // space as delimiter as none of these IDs allow spaces.
    return "PM_" + userId + " " + virtualUserId; // clobber based on this.
}

function createAdminId(userId) {
    return "ADMIN_" + userId; // clobber based on this.
}

function createMappingId(roomId, ircDomain, ircChannel) {
    // space as delimiter as none of these IDs allow spaces.
    return roomId + " " + ircDomain + " " + ircChannel; // clobber based on this
}

module.exports = DataStore;
