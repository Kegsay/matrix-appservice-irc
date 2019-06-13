const Promise = require("bluebird");
const envBundle = require("../util/env-bundle");

describe("MemberListSyncer", function() {

    const {env, config, roomMapping, test} = envBundle();
    let botClient = null;

    beforeEach(test.coroutine(function*() {
        config.ircService.servers[roomMapping.server].membershipLists.enabled = true;
        config.ircService.servers[roomMapping.server].membershipLists.floodDelayMs = 0;
        config.ircService.servers[
            roomMapping.server
        ].membershipLists.global.ircToMatrix.initial = true;
        config.ircService.servers[
            roomMapping.server
        ].membershipLists.global.matrixToIrc.initial = true;
        yield test.beforeEach(env);

        // make the bot automatically connect and join the mapped channel
        env.ircMock._autoConnectNetworks(
            roomMapping.server, roomMapping.botNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, roomMapping.botNick, roomMapping.channel
        );

        botClient = env.clientMock._client(config._botUserId);
    }));

    afterEach(test.coroutine(function*() {
        yield test.afterEach(env);
    }));

    it("should sync initial leaves from IRC to Matrix", test.coroutine(function*() {
        env.ircMock._autoConnectNetworks(
            roomMapping.server, "M-alice", roomMapping.server
        );
        env.ircMock._whenClient(roomMapping.server, "M-alice", "join", (client, chan, cb) => {
            expect(chan).toEqual(roomMapping.channel);
            client._invokeCallback(cb);
            process.nextTick(() => {
                // send the NAMES
                client.emit("names", chan, {
                    "not_alpha": "",
                    "beta": "",
                });
            });
        });

        let ircUserId = function(nick) {
            return `@${roomMapping.server}_${nick}:${config.homeserver.domain}`;
        };

        botClient._http.authedRequestWithPrefix.and.callFake(
        (cb, method, path, qps, data) => {
            if (method === "GET" && path === "/joined_rooms") {
                return Promise.resolve({
                    joined_rooms: [roomMapping.roomId]
                });
            }
            else if (method === "GET" &&
                    path === `/rooms/${encodeURIComponent(roomMapping.roomId)}/joined_members`) {
                return Promise.resolve({
                    joined: {
                        "@alice:bar": {},
                        [ircUserId("alpha")]: {},
                        [ircUserId("beta")]: {},
                    },
                });
            }
            return Promise.reject(new Error("unhandled path"));
        });

        let promise = new Promise((resolve, reject) => {
            // 'alpha' should leave
            let alphaClient = env.clientMock._client(ircUserId("alpha"));
            alphaClient.leave.and.callFake((roomId) => {
                expect(roomId).toEqual(roomMapping.roomId);
                resolve();
                return Promise.resolve({});
            });
        });

        yield test.initEnv(env);
        yield promise;
    }));

    it("should sync initial joins from Matrix to IRC", test.coroutine(function*() {
        botClient._http.authedRequestWithPrefix.and.callFake(
        (cb, method, path, qps, data) => {
            if (method === "GET" && path === "/joined_rooms") {
                return Promise.resolve({
                    joined_rooms: [roomMapping.roomId]
                });
            }
            else if (method === "GET" &&
                    path === `/rooms/${encodeURIComponent(roomMapping.roomId)}/joined_members`) {
                return Promise.resolve({
                    joined: {
                        "@alice:bar": {
                            display_name: null,
                            avatar_url: null,
                        },
                        "@bob:bar": {
                            display_name: "Bob",
                            avatar_url: null,
                        }
                    },
                });
            }
            return Promise.reject(new Error("unhandled path"));
        });

        let alicePromise = new Promise((resolve, reject) => {
            let aliceNick = "M-alice";
            env.ircMock._whenClient(roomMapping.server, aliceNick, "connect", function(client, cb) {
                client._invokeCallback(cb);
            });
            env.ircMock._whenClient(roomMapping.server, aliceNick, "join", (client, chan, cb) => {
                expect(chan).toEqual(roomMapping.channel);
                resolve();
                client._invokeCallback(cb);
            });
        });

        let bobPromise = new Promise((resolve, reject) => {
            let bobNick = "M-Bob";
            env.ircMock._whenClient(roomMapping.server, bobNick, "connect", function(client, cb) {
                client._invokeCallback(cb);
            });
            env.ircMock._whenClient(roomMapping.server, bobNick, "join", (client, chan, cb) => {
                expect(chan).toEqual(roomMapping.channel);
                resolve();
                client._invokeCallback(cb);
            });
        });

        yield test.initEnv(env);
        yield Promise.all([alicePromise, bobPromise]);
    }));
});
