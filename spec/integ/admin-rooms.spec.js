"use strict";
var Promise = require("bluebird");
var test = require("../util/test");

// set up integration testing mocks
var env = test.mkEnv();

// set up test config
var config = env.config;
var roomMapping = {
    server: config._server,
    botNick: config._botnick,
    channel: config._chan,
    roomId: config._roomid
};
var botUserId = config._botUserId;

describe("Creating admin rooms", function() {

    beforeEach(function(done) {
        test.beforeEach(this, env); // eslint-disable-line no-invalid-this

        env.ircMock._autoConnectNetworks(
            roomMapping.server, roomMapping.botNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, roomMapping.botNick, roomMapping.channel
        );

        test.initEnv(env).done(function() {
            done();
        });
    });

    it("should be possible by sending an invite to the bot's user ID",
    test.coroutine(function*() {
        var botJoinedRoom = false;
        var sdk = env.clientMock._client(botUserId);
        sdk.joinRoom.andCallFake(function(roomId) {
            expect(roomId).toEqual("!adminroomid:here");
            botJoinedRoom = true;
            return Promise.resolve({});
        });

        yield env.mockAppService._trigger("type:m.room.member", {
            content: {
                membership: "invite",
            },
            state_key: botUserId,
            user_id: "@someone:somewhere",
            room_id: "!adminroomid:here",
            type: "m.room.member"
        });
        expect(botJoinedRoom).toBe(true);
    }));
});

describe("Admin rooms", function() {
    var adminRoomId = "!adminroomid:here";
    var userId = "@someone:somewhere";
    var userIdNick = "M-someone";

    beforeEach(function(done) {
        test.beforeEach(this, env); // eslint-disable-line no-invalid-this

        // enable nick changes
        config.ircService.servers[roomMapping.server].ircClients.allowNickChanges = true;
        // enable private dynamic channels with the user ID in a whitelist
        config.ircService.servers[roomMapping.server].dynamicChannels.enabled = true;
        config.ircService.servers[roomMapping.server].dynamicChannels.whitelist = [
            userId
        ];
        config.ircService.servers[roomMapping.server].dynamicChannels.joinRule = "invite";
        config.ircService.servers[roomMapping.server].dynamicChannels.published = false;
        config.ircService.servers[roomMapping.server].dynamicChannels.createAlias = false;

        env.ircMock._autoConnectNetworks(
            roomMapping.server, roomMapping.botNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, roomMapping.botNick, roomMapping.channel
        );
        env.ircMock._autoConnectNetworks(
            roomMapping.server, userIdNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, userIdNick, roomMapping.channel
        );

        // auto-join an admin room
        var sdk = env.clientMock._client(userId);
        sdk.joinRoom.andCallFake(function(roomId) {
            expect([adminRoomId, roomMapping.roomId]).toContain(roomId);
            return Promise.resolve({});
        });

        test.initEnv(env, config).then(function() {
            // auto-setup an admin room
            return env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "invite"
                },
                state_key: botUserId,
                user_id: userId,
                room_id: adminRoomId,
                type: "m.room.member"
            });
        }).then(function() {
            // send a message to register the userId on the IRC network
            return env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "ping",
                    msgtype: "m.text"
                },
                user_id: userId,
                room_id: roomMapping.roomId,
                type: "m.room.message"
            });
        }).done(function() {
            done();
        });
    });

    it("should respond to bad !nick commands with a help notice",
    test.coroutine(function*() {
        var sentNotice = false;
        var sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.andCallFake(function(roomId, type, content) {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            sentNotice = true;
            return Promise.resolve();
        });

        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!nick blargle wargle",
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        expect(sentNotice).toBe(true);
    }));

    it("should respond to bad !join commands with a help notice",
    test.coroutine(function*() {
        var sentNotice = false;
        var sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.andCallFake(function(roomId, type, content) {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            sentNotice = true;
            return Promise.resolve();
        });

        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!join blargle",
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        })
        expect(sentNotice).toBe(true);
    }));

    it("should ignore messages sent by the bot", test.coroutine(function*() {
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!join blargle",
                msgtype: "m.text"
            },
            user_id: botUserId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
    }));

    it("should be able to change their nick using !nick",
    test.coroutine(function*() {
        var newNick = "Blurple";
        var testText = "I don't know what colour I am.";

        // make sure that the nick command is sent
        var sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
        function(client, command, arg) {
            expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
            expect(client.addr).toEqual(roomMapping.server);
            expect(command).toEqual("NICK");
            expect(arg).toEqual(newNick);
            client._changeNick(userIdNick, newNick);
            sentNickCommand = true;
        });

        // make sure that when a message is sent it uses the new nick
        var sentSay = false;
        env.ircMock._whenClient(roomMapping.server, newNick, "say",
        function(client, channel, text) {
            expect(client.nick).toEqual(newNick, "use the new nick on /say");
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(testText.length);
            expect(text).toEqual(testText);
            sentSay = true;
        });

        // make sure the AS sends an ACK of the request as a notice in the admin
        // room
        var sentAckNotice = false;
        var sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.andCallFake(function(roomId, type, content) {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            sentAckNotice = true;
            return Promise.resolve();
        });

        // trigger the request to change the nick
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!nick " + roomMapping.server + " " + newNick,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        // trigger the message which should use the new nick
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testText,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });

        // make sure everything was called
        expect(sentNickCommand).toBe(true, "sent nick IRC command");
        expect(sentAckNotice).toBe(true, "sent ACK m.notice");
        expect(sentSay).toBe(true, "sent say IRC command");
    }));

    it("should be able to change their nick using !nick and have it persist across disconnects",
    test.coroutine(function*() {
        jasmine.Clock.useMock();
        var newNick = "Blurple";
        var testText = "I don't know what colour I am.";
        // we will be disconnecting the user so we want to accept incoming connects/joins
        // as the new nick.
        env.ircMock._autoConnectNetworks(
            roomMapping.server, newNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, newNick, roomMapping.channel
        );

        // make sure that the nick command is sent
        var sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
        function(client, command, arg) {
            expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
            expect(client.addr).toEqual(roomMapping.server);
            expect(command).toEqual("NICK");
            expect(arg).toEqual(newNick);
            client._changeNick(userIdNick, newNick);
            sentNickCommand = true;
        });

        // make sure that when a message is sent it uses the new nick
        var sentSay = false;
        env.ircMock._whenClient(roomMapping.server, newNick, "say",
        function(client, channel, text) {
            expect(client.nick).toEqual(newNick, "use the new nick on /say");
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(testText.length);
            expect(text).toEqual(testText);
            sentSay = true;
        });

        // make sure the AS sends an ACK of the request as a notice in the admin
        // room
        var sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.andCallFake(function(roomId, type, content) {
            return Promise.resolve();
        });

        // trigger the request to change the nick
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!nick " + roomMapping.server + " " + newNick,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });

        // disconnect the user
        var cli = yield env.ircMock._findClientAsync(roomMapping.server, newNick);
        cli.emit("error", {command: "err_testsezno"});

        // wait a bit for reconnect timers
        setImmediate(function() {
            jasmine.Clock.tick(1000 * 11);
        });


        // trigger the message which should use the new nick
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testText,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });

        // make sure everything was called
        expect(sentNickCommand).toBe(true, "Client did not send nick IRC command");
        expect(sentSay).toBe(true, "Client did not send message as new nick");
    }));

    it("should reject !nick changes for IRC errors",
    test.coroutine(function*() {
        var newNick = "Blurple";
        var testText = "I don't know what colour I am.";

        // make sure that the nick command is sent
        var sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
        function(client, command, arg) {
            expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
            expect(client.addr).toEqual(roomMapping.server);
            expect(command).toEqual("NICK");
            expect(arg).toEqual(newNick);
            client.emit("error", {
                commandType: "error",
                command: "err_nicktoofast"
            })
            sentNickCommand = true;
        });

        // make sure that when a message is sent it uses the old nick
        var sentSay = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "say",
        function(client, channel, text) {
            expect(client.nick).toEqual(userIdNick, "use the new nick on /say");
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(testText.length);
            expect(text).toEqual(testText);
            sentSay = true;
        });

        // make sure the AS sends an ACK of the request as a notice in the admin
        // room
        var sentAckNotice = false;
        var sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.andCallFake(function(roomId, type, content) {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body.indexOf("err_nicktoofast")).not.toEqual(-1);
            sentAckNotice = true;
            return Promise.resolve();
        });

        // trigger the request to change the nick
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!nick " + roomMapping.server + " " + newNick,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        // trigger the message which should use the OLD nick
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testText,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });

        // make sure everything was called
        expect(sentNickCommand).toBe(true, "sent nick IRC command");
        expect(sentAckNotice).toBe(true, "sent ACK m.notice");
        expect(sentSay).toBe(true, "sent say IRC command");
    }));

    it("should timeout !nick changes after 10 seconds", test.coroutine(function*() {
        jasmine.Clock.useMock();
        var newNick = "Blurple";

        // make sure that the NICK command is sent
        var sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
        function(client, command, arg) {
            expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
            expect(client.addr).toEqual(roomMapping.server);
            expect(command).toEqual("NICK");
            expect(arg).toEqual(newNick);
            // don't emit anything.. and speed up time
            setImmediate(function() {
                jasmine.Clock.tick(1000 * 11);
            });

            sentNickCommand = true;
        });

        // make sure the AS sends a timeout error as a notice in the admin
        // room
        var sentAckNotice = false;
        var sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.andCallFake(function(roomId, type, content) {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body.indexOf("Timed out")).not.toEqual(-1);
            sentAckNotice = true;
            return Promise.resolve();
        });

        // trigger the request to change the nick
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!nick " + roomMapping.server + " " + newNick,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });

        // make sure everything was called
        expect(sentNickCommand).toBe(true, "sent nick IRC command");
        expect(sentAckNotice).toBe(true, "sent ACK m.notice");
    }));

    it("should be able to join a channel with !join if they are on the whitelist",
    test.coroutine(function*() {
        var newChannel = "#awooga";
        var newRoomId = "!aasifuhawei:efjkwehfi";

        // let the bot join the irc channel
        var joinedChannel = false;
        env.ircMock._whenClient(roomMapping.server, roomMapping.botNick, "join",
        function(client, chan, cb) {
            if (chan === newChannel) {
                joinedChannel = true;
                if (cb) { cb(); }
            }
        });

        // make sure the AS creates a new PRIVATE matrix room.
        var createdMatrixRoom = false;
        var sdk = env.clientMock._client(botUserId);
        sdk.createRoom.andCallFake(function(opts) {
            expect(opts.visibility).toEqual("private");
            expect(opts.invite).toEqual([userId]);
            createdMatrixRoom = true;
            return Promise.resolve({
                room_id: newRoomId
            });
        });

        // trigger the request to join a channel
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!join " + roomMapping.server + " " + newChannel,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        })

        // make sure everything was called
        expect(createdMatrixRoom).toBe(true, "Did not create matrix room");
        expect(joinedChannel).toBe(true, "Bot didn't join channel");
    }));

    it("should be able to join a channel with !join and a key",
    test.coroutine(function*() {
        var newChannel = "#awooga";
        var newRoomId = "!aasifuhawei:efjkwehfi";
        var key = "secret";

        // let the bot join the irc channel
        var joinedChannel = false;
        env.ircMock._whenClient(roomMapping.server, roomMapping.botNick, "join",
        function(client, chan, cb) {
            if (chan === (newChannel + " " + key)) {
                joinedChannel = true;
                if (cb) { cb(); }
            }
        });

        // Because we gave a key, we expect the user to be joined (with the key)
        // immediately.
        env.ircMock._whenClient(roomMapping.server, userIdNick, "join",
        function(client, chan, cb) {
            if (chan === (newChannel + " " + key)) {
                joinedChannel = true;
                if (cb) { cb(); }
            }
        });

        // make sure the AS creates a new PRIVATE matrix room.
        var createdMatrixRoom = false;
        var sdk = env.clientMock._client(botUserId);
        sdk.createRoom.andCallFake(function(opts) {
            expect(opts.visibility).toEqual("private");
            expect(opts.invite).toEqual([userId]);
            createdMatrixRoom = true;
            return Promise.resolve({
                room_id: newRoomId
            });
        });

        // trigger the request to join a channel
        yield env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!join " + roomMapping.server + " " + newChannel + " " + key,
                msgtype: "m.text"
            },
            user_id: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        })

        // make sure everything was called
        expect(createdMatrixRoom).toBe(true, "Did not create matrix room");
        expect(joinedChannel).toBe(true, "Bot didn't join channel");
    }));
});
