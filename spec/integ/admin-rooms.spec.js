const envBundle = require("../util/env-bundle");

describe("Creating admin rooms", () => {
    const {env, roomMapping, botUserId, test} = envBundle();

    beforeEach(async () => {
        await test.beforeEach(env);

        env.ircMock._autoConnectNetworks(
            roomMapping.server, roomMapping.botNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, roomMapping.botNick, roomMapping.channel
        );

        await test.initEnv(env);
    });

    afterEach(async () => test.afterEach(env));

    it("should be possible by sending an invite to the bot's user ID", async () => {
            let botJoinedRoom = false;
            const sdk = env.clientMock._client(botUserId);
            sdk.joinRoom.and.callFake(async (roomId) => {
                expect(roomId).toEqual("!adminroomid:here");
                botJoinedRoom = true;
                return {};
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "invite",
                    is_direct: true,
                },
                state_key: botUserId,
                sender: "@someone:somewhere",
                room_id: "!adminroomid:here",
                type: "m.room.member"
            });
            expect(botJoinedRoom).toBe(true);
    });

    it("should not create a room for a non is_direct invite", async () => {
            let botJoinedRoom = false;
            const sdk = env.clientMock._client(botUserId);
            sdk.joinRoom.and.callFake(async (roomId) => {
                expect(roomId).toEqual("!adminroomid:here");
                botJoinedRoom = true;
                return {};
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "invite",
                },
                state_key: botUserId,
                sender: "@someone:somewhere",
                room_id: "!adminroomid:here",
                type: "m.room.member"
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "invite",
                    is_direct: false,
                },
                state_key: botUserId,
                sender: "@someone:somewhere",
                room_id: "!adminroomid:here",
                type: "m.room.member"
            });

            expect(botJoinedRoom).toBe(false);
        });
});

describe("Admin rooms", function() {
    const adminRoomId = "!adminroomid:here";
    const userId = "@someone:somewhere";
    const userIdNick = "M-someone";

    const {env, config, roomMapping, botUserId, test} = envBundle();


    beforeEach(async () => {
        await test.beforeEach(env);

        // enable syncing
        config.ircService.servers[config._server].membershipLists.enabled = true;
        config.ircService.servers[
            config._server
        ].membershipLists.global.matrixToIrc.incremental = true;

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
        const sdk = env.clientMock._client(userId);
        sdk.joinRoom.and.callFake((roomId) => {
            expect([adminRoomId, roomMapping.roomId]).toContain(roomId);
            return {};
        });

        jasmine.clock().install();

        await test.initEnv(env, config);

        // auto-setup an admin room
        await env.mockAppService._trigger("type:m.room.member", {
            content: {
                membership: "invite",
                is_direct: true
            },
            state_key: botUserId,
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.member"
        });

        // send a message to register the userId on the IRC network
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "ping",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    afterEach(() => {
        jasmine.clock().uninstall();
        return test.afterEach(env);
    });

    it("should respond to bad !nick commands with a help notice", async () => {
            let sentNotice = false;
            const sdk = env.clientMock._client(botUserId);
            sdk.sendEvent.and.callFake((roomId, type, content) => {
                expect(roomId).toEqual(adminRoomId);
                expect(content.msgtype).toEqual("m.notice");
                sentNotice = true;
            });

            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "!nick blargle wargle",
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            });
            expect(sentNotice).toBe(true);
        });

    it("should respond to bad !join commands with a help notice", async () => {
            let sentNotice = false;
            const sdk = env.clientMock._client(botUserId);
            sdk.sendEvent.and.callFake((roomId, type, content) =>{
                expect(roomId).toEqual(adminRoomId);
                expect(content.msgtype).toEqual("m.notice");
                sentNotice = true;
            });

            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "!join blargle",
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            })
            expect(sentNotice).toBe(true);
    });

    it("should respond to unknown commands with a notice", async () => {
            let sentNotice = false;
            const sdk = env.clientMock._client(botUserId);
            sdk.sendEvent.and.callFake((roomId, type, content) => {
                expect(roomId).toEqual(adminRoomId);
                expect(content.msgtype).toEqual("m.notice");
                sentNotice = true;
            });

            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "notacommand",
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            })
            expect(sentNotice).toBe(true);
    });

    it("should ignore messages sent by the bot", () => {
        return env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!join blargle",
                msgtype: "m.text"
            },
            sender: botUserId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
    });

    it("should be able to change their nick using !nick", async () => {
        const newNick = "Blurple";
        const testText = "I don't know what colour I am.";

        // make sure that the nick command is sent
        let sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send", (client, command, arg) => {
            expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
            expect(client.addr).toEqual(roomMapping.server);
            expect(command).toEqual("NICK");
            expect(arg).toEqual(newNick);
            client._changeNick(userIdNick, newNick);
            sentNickCommand = true;
        });

        env.ircMock._whenClient(roomMapping.server, userIdNick, "whois", (client, whoisNick) => {
            expect(whoisNick).toEqual(newNick);
            client.emit("error", {
                commandType: "error",
                command: "err_nosuchnick",
                args: [undefined, newNick]
            });
        });

        // make sure that when a message is sent it uses the new nick
        let sentSay = false;
        env.ircMock._whenClient(roomMapping.server, newNick, "say", (client, channel, text) => {
            expect(client.nick).toEqual(newNick, "use the new nick on /say");
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(testText.length);
            expect(text).toEqual(testText);
            sentSay = true;
        });

        // make sure the AS sends an ACK of the request as a notice in the admin
        // room
        let sentAckNotice = false;
        const sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.and.callFake((roomId, type, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual(`Nick changed from '${userIdNick}' to '${newNick}'.`);
            sentAckNotice = true;
        });

        // trigger the request to change the nick
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!nick " + roomMapping.server + " " + newNick,
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        // trigger the message which should use the new nick
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testText,
                msgtype: "m.text"
            },
            sender: userId,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });

        // make sure everything was called
        expect(sentNickCommand).withContext("sent nick IRC command").toBeTrue();
        expect(sentAckNotice).withContext("sent ACK m.notice").toBeTrue();
        expect(sentSay).withContext("sent say IRC command").toBeTrue();
    });

    it("should be able to keep their name using !nick", async () => {
        const newNick = userIdNick;
        const testText = "I don't know what colour I am.";

        // make sure that the nick command is sent (expected to NOT run)
        let sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
            function (client, command, arg) {
                expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
                expect(client.addr).toEqual(roomMapping.server);
                expect(command).toEqual("NICK");
                expect(arg).toEqual(newNick);
                client._changeNick(userIdNick, newNick);
                sentNickCommand = true;
            }
        );

        // make sure that when a message is sent it uses the new nick
        let sentSay = false;
        env.ircMock._whenClient(roomMapping.server, newNick, "say",
            function (client, channel, text) {
                expect(client.nick).toEqual(newNick, "use the new nick on /say");
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                expect(text.length).toEqual(testText.length);
                expect(text).toEqual(testText);
                sentSay = true;
            }
        );

        // make sure the AS sends an ACK of the request as a notice in the admin
        // room
        let sentAckNotice = false;
        const sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.and.callFake(function (roomId, type, content) {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual(`Your nick is already '${newNick}'.`);
            sentAckNotice = true;
        });

        // trigger the request to change the nick
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: `!nick ${roomMapping.server} ${newNick}`,
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        // trigger the message which should use the new nick
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testText,
                msgtype: "m.text"
            },
            sender: userId,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });

        // make sure everything was called
        expect(sentNickCommand).toBe(false, "sent nick IRC command");
        expect(sentAckNotice).toBe(true, "sent ACK m.notice");
        expect(sentSay).toBe(true, "sent say IRC command");
    });

    it("should be able to change their nick using !nick and have it persist across disconnects", async () => {
            const newNick = "Blurple";
            const testText = "I don't know what colour I am.";
            // we will be disconnecting the user so we want to accept incoming connects/joins
            // as the new nick.
            env.ircMock._autoConnectNetworks(
                roomMapping.server, newNick, roomMapping.server
            );
            env.ircMock._autoJoinChannels(
                roomMapping.server, newNick, roomMapping.channel
            );

            // make sure that the nick command is sent
            let sentNickCommand = false;
            env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
                function(client, command, arg) {
                    expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
                    expect(client.addr).toEqual(roomMapping.server);
                    expect(command).toEqual("NICK");
                    expect(arg).toEqual(newNick);
                    client._changeNick(userIdNick, newNick);
                    sentNickCommand = true;
                });

            env.ircMock._whenClient(roomMapping.server, userIdNick, "whois", (client, whoisNick) => {
                expect(whoisNick).toEqual(newNick);
                client.emit("error", {
                    commandType: "error",
                    command: "err_nosuchnick",
                    args: [undefined, newNick]
                });
            });

            // make sure that when a message is sent it uses the new nick
            let sentSay = false;
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
            const sdk = env.clientMock._client(botUserId);
            sdk.sendEvent.and.callFake((roomId, type, content) => {
                return Promise.resolve();
            });

            // trigger the request to change the nick
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "!nick " + roomMapping.server + " " + newNick,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            });

            // disconnect the user
            const cli = await env.ircMock._findClientAsync(roomMapping.server, newNick);
            cli.emit("error", {command: "err_testsezno"});

            // wait a bit for reconnect timers
            setImmediate(function() {
                jasmine.clock().tick(1000 * 11);
            });


            // trigger the message which should use the new nick
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: testText,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: roomMapping.roomId,
                type: "m.room.message"
            });

            // make sure everything was called
            expect(sentNickCommand).toBe(true, "Client did not send nick IRC command");
            expect(sentSay).toBe(true, "Client did not send message as new nick");
    });

    it("should be able to change their nick using !nick and have it persist " +
        "when changing the display name", async () =>{
        const newNick = "Blurple";
        const displayName = "Durple";

        // make sure that the nick command is sent
        let sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
            function(client, command, arg) {
                expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
                expect(client.addr).toEqual(roomMapping.server);
                expect(command).toEqual("NICK");
                expect(arg).toEqual(newNick);
                client._changeNick(userIdNick, newNick);
                sentNickCommand = true;
            });

        env.ircMock._whenClient(roomMapping.server, userIdNick, "whois", (client, whoisNick) => {
            expect(whoisNick).toEqual(newNick);
            client.emit("error", {
                commandType: "error",
                command: "err_nosuchnick",
                args: [undefined, newNick]
            });
        });

        // make sure that a display name change is not propagated
        let sentNick = false;
        env.ircMock._whenClient(roomMapping.server, newNick, "send",
            function(client, channel, text) {
                sentNick = true;
            });

        // trigger the request to change the nick
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!nick " + roomMapping.server + " " + newNick,
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });

        // trigger a display name change
        await env.mockAppService._trigger("type:m.room.member", {
            content: {
                membership: "join",
                avatar_url: null,
                displayname: displayName
            },
            state_key: userId,
            sender: userId,
            room_id: roomMapping.roomId,
            type: "m.room.member",
        });

        // make sure everything was called
        expect(sentNickCommand).toBe(true, "sent nick IRC command");
        expect(sentNick).toBe(false, "sent nick IRC command on displayname change");
    });

    it("should propagate a display name change as a nick change when no custom nick is set", async () => {
            const newNick = "Blurple";

            const sdk = env.clientMock._client(botUserId);
            sdk.getUserProfile.and.callFake(async (reqUserId) => {
                expect(reqUserId).toEqual(userId);
                return {displayname: newNick};
            });

            // make sure that the nick command is sent
            let sentNickCommand = false;
            env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
                function(client, command, arg) {
                    expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
                    expect(client.addr).toEqual(roomMapping.server);
                    expect(command).toEqual("NICK");
                    expect(arg).toEqual('M-' + newNick);
                    sentNickCommand = true;
                });

            env.ircMock._whenClient(roomMapping.server, userIdNick, "whois", (client, whoisNick) => {
                expect(whoisNick).toEqual('M-' + newNick);
                client.emit("error", {
                    commandType: "error",
                    command: "err_nosuchnick",
                    args: [undefined, 'M-' + newNick]
                });
            });

            // trigger a display name change
            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "join",
                    avatar_url: null,
                    displayname: newNick
                },
                state_key: userId,
                sender: userId,
                room_id: roomMapping.roomId,
                type: "m.room.member",
            });

            // make sure everything was called
            expect(sentNickCommand).toBe(true, "sent nick IRC command");
    });

    it("should reject !nick changes for IRC errors", async () => {
            const newNick = "Blurple";
            const testText = "I don't know what colour I am.";

            // make sure that the nick command is sent
            let sentNickCommand = false;
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

            env.ircMock._whenClient(roomMapping.server, userIdNick, "whois", (client, whoisNick) => {
                expect(whoisNick).toEqual(newNick);
                client.emit("error", {
                    commandType: "error",
                    command: "err_nosuchnick",
                    args: [undefined, newNick]
                });
            });

            // make sure that when a message is sent it uses the old nick
            let sentSay = false;
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
            let sentAckNotice = false;
            const sdk = env.clientMock._client(botUserId);
            sdk.sendEvent.and.callFake((roomId, type, content) => {
                expect(roomId).toEqual(adminRoomId);
                expect(content.msgtype).toEqual("m.notice");
                expect(content.body.indexOf("err_nicktoofast")).not.toEqual(-1);
                sentAckNotice = true;
                return Promise.resolve();
            });

            // trigger the request to change the nick
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "!nick " + roomMapping.server + " " + newNick,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            });
            // trigger the message which should use the OLD nick
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: testText,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: roomMapping.roomId,
                type: "m.room.message"
            });

            // make sure everything was called
            expect(sentNickCommand).toBe(true, "sent nick IRC command");
            expect(sentAckNotice).toBe(true, "sent ACK m.notice");
            expect(sentSay).toBe(true, "sent say IRC command");
    });

    it("should timeout !nick changes after 10 seconds", async () => {
        const newNick = "Blurple";

        // make sure that the NICK command is sent
        let sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
            function(client, command, arg) {
                expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
                expect(client.addr).toEqual(roomMapping.server);
                expect(command).toEqual("NICK");
                expect(arg).toEqual(newNick);
                // don't emit anything.. and speed up time
                setImmediate(function() {
                    jasmine.clock().tick(1000 * 11);
                });

                sentNickCommand = true;
            });

        env.ircMock._whenClient(roomMapping.server, userIdNick, "whois", (client, whoisNick) => {
            expect(whoisNick).toEqual(newNick);
            client.emit("error", {
                commandType: "error",
                command: "err_nosuchnick",
                args: [undefined, newNick]
            });
        });

        // make sure the AS sends a timeout error as a notice in the admin
        // room
        let sentAckNotice = false;
        const sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.and.callFake((roomId, type, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body.indexOf("Timed out")).not.toEqual(-1);
            sentAckNotice = true;
        });

        // trigger the request to change the nick
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!nick " + roomMapping.server + " " + newNick,
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });

        // make sure everything was called
        expect(sentNickCommand).toBe(true, "sent nick IRC command");
        expect(sentAckNotice).toBe(true, "sent ACK m.notice");
    });

    it("should not try to change to a nickname that is already in use", async () => {
        const newNick = "Blurple";

        // make sure that the NICK command not is sent
        let sentNickCommand = false;
        env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
            function(client, command, arg) {
                expect(client.nick).toEqual(userIdNick, "use the old nick on /nick");
                expect(client.addr).toEqual(roomMapping.server);
                expect(command).toEqual("NICK");
                expect(arg).toEqual(newNick);
                sentNickCommand = true;
            });

        env.ircMock._whenClient(roomMapping.server, userIdNick, "whois", (client, whoisNick, callback) => {
            expect(whoisNick).toEqual(newNick);
            callback({user: {
                data: "hello"
            }, nick: whoisNick});
        });

        // make sure the AS sends a timeout error as a notice in the admin
        // room
        let sentAckNotice = false;
        const sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.and.callFake((roomId, type, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).not.toEqual(
                `The nickname ${newNick} is taken on ${roomMapping.server.domain}.` +
            "Please pick a different nick.");
            sentAckNotice = true;
        });

        // trigger the request to change the nick
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: `!nick ${roomMapping.server} ${newNick}`,
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });

        // make sure everything was called
        expect(sentNickCommand).toBe(false, "did not send nick IRC command");
        expect(sentAckNotice).toBe(true, "sent ACK m.notice");
    });

    it("should be able to join a channel with !join if they are on the whitelist", async () => {
            const newChannel = "#awooga";
            const newRoomId = "!aasifuhawei:efjkwehfi";
            const serverConfig = env.config.ircService.servers[roomMapping.server];
            const serverShouldPublishRooms = serverConfig.dynamicChannels.published;
            const serverJoinRule = serverConfig.dynamicChannels.joinRule;

            // let the bot join the irc channel
            let joinedChannel = false;
            env.ircMock._whenClient(roomMapping.server, roomMapping.botNick, "join",
                function(client, chan, cb) {
                    if (chan === newChannel) {
                        joinedChannel = true;
                        if (cb) { cb(); }
                    }
                });

            // let the user join the IRC channel because of membership syncing
            env.ircMock._whenClient(roomMapping.server, userIdNick, "join",
                function(client, chan, cb) {
                    if (chan === newChannel && cb) { cb(); }
                });

            // make sure the AS creates a new PRIVATE matrix room.
            let createdMatrixRoom = false;
            const sdk = env.clientMock._client(botUserId);
            sdk.createRoom.and.callFake(function(opts) {
                expect(opts.visibility).toEqual(serverShouldPublishRooms ? "public" : "private");
                expect(
                    opts.initial_state.find(
                        (s)=> s.type === 'm.room.join_rules'
                    ).content.join_rule
                ).toEqual(serverJoinRule);
                expect(opts.invite).toEqual([userId]);
                createdMatrixRoom = true;
                return Promise.resolve({
                    room_id: newRoomId
                });
            });

            // trigger the request to join a channel
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "!join " + roomMapping.server + " " + newChannel,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            });

            // make sure everything was called
            expect(createdMatrixRoom).toBe(true, "Did not create matrix room");
            expect(joinedChannel).toBe(true, "Bot didn't join channel");
    });

    it("should be able to join a channel with !join and a key", async () => {
            const newChannel = "#awooga";
            const newRoomId = "!aasifuhawei:efjkwehfi";
            const key = "secret";
            const serverConfig = env.config.ircService.servers[roomMapping.server];
            const serverShouldPublishRooms = serverConfig.dynamicChannels.published;
            const serverJoinRule = serverConfig.dynamicChannels.joinRule;

            // let the bot join the irc channel
            let joinedChannel = false;
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
            let createdMatrixRoom = false;
            const sdk = env.clientMock._client(botUserId);
            sdk.createRoom.and.callFake(function(opts) {
                expect(opts.visibility).toEqual(serverShouldPublishRooms ? "public" : "private");
                expect(
                    opts.initial_state.find(
                        (s)=> s.type === 'm.room.join_rules'
                    ).content.join_rule
                ).toEqual(serverJoinRule);
                expect(opts.invite).toEqual([userId]);
                createdMatrixRoom = true;
                return Promise.resolve({
                    room_id: newRoomId
                });
            });

            // trigger the request to join a channel
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "!join " + roomMapping.server + " " + newChannel + " " + key,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            })

            // make sure everything was called
            expect(createdMatrixRoom).toBe(true, "Did not create matrix room");
            expect(joinedChannel).toBe(true, "Bot didn't join channel");
    });

    it("should allow arbitrary IRC commands to be issued", async () => {
            const newChannel = "#coffee";

            // Expect the following commands to be sent in order
            const recvCommands = ["JOIN", "TOPIC", "PART", "STUPID"];

            let cmdIx = 0;
            env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
                function(client) {
                    const args = Array.from(arguments).splice(1);
                    const keyword = args[0];

                    expect(keyword).toBe(recvCommands[cmdIx]);
                    cmdIx++;
                });

            // 5 commands should be executed
            // rubbishserver should not be accepted
            const commands = [
                `!cmd ${roomMapping.server} JOIN ${newChannel}`,
                `!cmd ${roomMapping.server} TOPIC ${newChannel} :some new fancy topic`,
                `!cmd ${roomMapping.server} PART ${newChannel}`,
                `!cmd ${roomMapping.server} STUPID COMMANDS`,
                `!cmd rubbishserver SOME COMMAND`];

            for (let i = 0; i < commands.length; i++) {
            // send commands
                await env.mockAppService._trigger("type:m.room.message", {
                    content: {
                        body: commands[i],
                        msgtype: "m.text"
                    },
                    sender: userId,
                    room_id: adminRoomId,
                    type: "m.room.message"
                });
            }

            expect(cmdIx).toBe(recvCommands.length);
    });

    it("should allow arbitrary IRC commands to be issued when server has not been set", async () => {
            const newChannel = "#coffee";

            // Expect the following commands to be sent in order
            const recvCommands = ["JOIN", "TOPIC", "PART", "STUPID"];

            let cmdIx = 0;
            env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
                function(client) {
                    const args = Array.from(arguments).splice(1);
                    const keyword = args[0];

                    expect(keyword).toBe(recvCommands[cmdIx]);
                    cmdIx++;
                });

            const commands = [
                `!cmd JOIN ${newChannel}`,
                `!cmd TOPIC ${newChannel} :some new fancy topic`,
                `!cmd PART ${newChannel}`,
                `!cmd STUPID COMMANDS`];

            for (let i = 0; i < commands.length; i++) {
            // send commands
                await env.mockAppService._trigger("type:m.room.message", {
                    content: {
                        body: commands[i],
                        msgtype: "m.text"
                    },
                    sender: userId,
                    room_id: adminRoomId,
                    type: "m.room.message"
                });
            }

            expect(cmdIx).toBe(recvCommands.length);
    });

    it("should reject malformed commands (new form)", async () => {
            let cmdCount = 0;
            env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
                function(client) {
                    cmdCount++;
                });

            const command = `!cmd M4LF0RM3D command`;

            // send command
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: command,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            });

            expect(cmdCount).toBe(0);
    });

    it("should reject PROTOCTL commands", async () => {
            let cmdCount = 0;
            env.ircMock._whenClient(roomMapping.server, userIdNick, "send",
                function(client) {
                    cmdCount++;
                });

            const command = `!cmd PROTOCTL command`;

            // send command
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: command,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            });

            expect(cmdCount).toBe(0);
    });

    it("mx bot should be kicked when there are > 2 users in room and a message is sent", async () => {

            const intent = env.clientMock._intent(botUserId);
            const sdk = intent.underlyingClient;
            sdk.getRoomState.and.callFake(
                function (roomId) {
                    expect(roomId).toBe(adminRoomId, 'Room state returned should be for admin room');
                    return Promise.resolve([
                        {
                            content: {membership: "join"},
                            type: "m.room.member",
                            state_key: "fake bot state"
                        },
                        {
                            content: {membership: "join"},
                            type: "m.room.member",
                            state_key: "fake user1 state"
                        },
                        {content:
                        {membership: "join"},
                        type: "m.room.member",
                        state_key: "fake user2 state"
                        }
                    ]);
                }
            );

            let botLeft = false
            intent.leaveRoom.and.callFake(function(roomId) {
                expect(roomId).toBe(adminRoomId, 'Bot did not leave admin room');
                botLeft = true;
                return Promise.resolve();
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "join",
                },
                state_key: botUserId,
                sender: "@user1:localhost",
                room_id: adminRoomId,
                type: "m.room.member"
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "join",
                },
                state_key: botUserId,
                sender: "@user2:localhost",
                room_id: adminRoomId,
                type: "m.room.member"
            });

            // trigger the bot to leave
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "ping",
                    msgtype: "m.text"
                },
                sender: "@user2:localhost",
                room_id: adminRoomId,
                type: "m.room.message"
            }).then(
                () => {
                    expect(botLeft).toBe(true);
                },
                (err) => {console.log(err)}
            );
    });

    it("mx bot should be NOT kicked when there are > 2 users in room and functional members are present", async () => {

        const intent = env.clientMock._intent(botUserId);
        const sdk = intent.underlyingClient;
        sdk.getRoomState.and.callFake(
            function (roomId) {
                expect(roomId).toBe(adminRoomId, 'Room state returned should be for admin room');
                return Promise.resolve([
                    {
                        content: {membership: "join"},
                        type: "m.room.member",
                        state_key: "@bot:fake"
                    },
                    {
                        content: {membership: "join"},
                        type: "m.room.member",
                        state_key: "@user1:fake"
                    },
                    {
                        content: {membership: "join"},
                        type: "m.room.member",
                        state_key: "@user2:fake"
                    }, {
                        type: "io.element.functional_members",
                        state_key: "",
                        content: {
                            service_members: ["@user2:fake"]
                        }
                    }
                ]);
            }
        );

        intent.leaveRoom.and.callFake(function(roomId) {
            fail('Bot should not leave room');
        });

        let sentMessage = true;
        sdk.sendEvent.and.callFake((roomId, type, content) => {
            expect(roomId).toBe(adminRoomId, 'Bot did not send message to admin room');
            sentMessage = true;
            return Promise.resolve({});
        });

        await env.mockAppService._trigger("type:m.room.member", {
            content: {
                membership: "join",
            },
            state_key: botUserId,
            sender: "@user1:localhost",
            room_id: adminRoomId,
            type: "m.room.member"
        });

        await env.mockAppService._trigger("type:m.room.member", {
            content: {
                membership: "join",
            },
            state_key: botUserId,
            sender: "@user2:localhost",
            room_id: adminRoomId,
            type: "m.room.member"
        });

        // trigger the bot to leave
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!help",
                msgtype: "m.text"
            },
            sender: "@user2:localhost",
            room_id: adminRoomId,
            type: "m.room.message"
        }).then(
            () => {
                expect(sentMessage).toBe(true);
            },
            (err) => {console.log(err)}
        );
});

    it("mx bot should NOT be kicked when there are 2 users in room and a message is sent", async () => {
            const intent = env.clientMock._intent(botUserId);
            const sdk = intent.underlyingClient;
            sdk.getRoomState.and.callFake(
                function (roomId) {
                    expect(roomId).toBe(adminRoomId, 'Room state returned should be for admin room');
                    return Promise.resolve([
                        {content: {membership: "join"}, type: "m.room.member", state_key: ":)"},
                        {content: {membership: "join"}, type: "m.room.member", state_key: ";)"}
                    ]);
                }
            );

            let botLeft = false
            intent.leaveRoom.and.callFake(function(roomId) {
                expect(roomId).toBe(adminRoomId, 'Bot did not leave admin room');
                botLeft = true;
                return Promise.resolve();
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "join",
                },
                state_key: botUserId,
                sender: "@user1:localhost",
                room_id: adminRoomId,
                type: "m.room.member"
            });

            // trigger the bot to leave
            await env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body: "ping",
                    msgtype: "m.text"
                },
                sender: "@user2:localhost",
                room_id: adminRoomId,
                type: "m.room.message"
            }).then(
                () => {
                    expect(botLeft).toBe(false);
                },
                (err) => {console.log(err)}
            );
    });

    it("should respond with a feature status for !feature", function(done) {
        const sdk = env.clientMock._client(botUserId);
        sdk.sendEvent.and.callFake((roomId, type, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual("'mentions' is set to the default value.");
            done();
            return Promise.resolve({});
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!feature mentions",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
    });

    it("should set feature status with !feature", function(done) {
        const sdk = env.clientMock._client(botUserId);
        let msgN = 0;
        sdk.sendEvent.and.callFake((roomId, type, content) => {
            if (msgN === 0) {
                expect(roomId).toEqual(adminRoomId);
                expect(content.msgtype).toEqual("m.notice");
                expect(content.body).toEqual("Set mentions to true.");
                msgN++;
                env.mockAppService._trigger("type:m.room.message", {
                    content: {
                        body: "!feature mentions",
                        msgtype: "m.text"
                    },
                    sender: userId,
                    room_id: adminRoomId,
                    type: "m.room.message"
                });
            }
            else {
                expect(roomId).toEqual(adminRoomId);
                expect(content.msgtype).toEqual("m.notice");
                expect(content.body).toEqual("'mentions' is enabled.");
                done();
            }
            return Promise.resolve({});
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!feature mentions true",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
    });

    it("!feature should fail with a missing or invalidate feature-name", function(done) {
        const sdk = env.clientMock._client(botUserId);
        let msgN = 0;
        sdk.sendEvent.and.callFake((roomId, type, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body.startsWith(
                "Missing or unknown feature flag. Must be one of:"
            )).toBe(true);
            msgN++
            if (msgN === 3) {
                done();
            }
            return Promise.resolve({});
        });
        for (const body of ["!feature", "!feature doggo", "!feature enabled"]) {
            env.mockAppService._trigger("type:m.room.message", {
                content: {
                    body,
                    msgtype: "m.text"
                },
                sender: userId,
                room_id: adminRoomId,
                type: "m.room.message"
            });
        }
    });

    it("should set feature status with !feature", function(done) {
        const sdk = env.clientMock._client(botUserId);
        let msgN = 0;
        sdk.sendEvent.and.callFake((roomId, type, content) => {
            if (msgN === 0) {
                expect(roomId).toEqual(adminRoomId);
                expect(content.msgtype).toEqual("m.notice");
                expect(content.body).toEqual("Parameter must be either true, false or default.");
                msgN++;
                env.mockAppService._trigger("type:m.room.message", {
                    content: {
                        body: "!feature mentions",
                        msgtype: "m.text"
                    },
                    sender: userId,
                    room_id: adminRoomId,
                    type: "m.room.message"
                });
            }
            else {
                expect(roomId).toEqual(adminRoomId);
                expect(content.msgtype).toEqual("m.notice");
                expect(content.body).toEqual("'mentions' is set to the default value.");
                done();
            }
            return Promise.resolve({});
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!feature mentions bacon",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
    });

    it("should reconnect when using !reconnect", async function() {
        const disconnectPromise = env.ircMock._whenClient(roomMapping.server, userIdNick, "disconnect", () => { });
        const connectPromise = env.ircMock._whenClient(roomMapping.server, userIdNick, "connect", () => { });
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!reconnect",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        await disconnectPromise;
        await connectPromise;
    });

    it("should be able to store a username with !username", async function() {
        const sdk = env.clientMock._client(botUserId);

        const sendPromise = sdk.sendEvent.and.callFake(async (roomId, _, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual(
                "Successfully stored username for irc.example. Use !reconnect to use this username now."
            );
            return {};
        });

        // Ensure that the user reconnects
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!username foobar\"[]{}`_^",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        await sendPromise;
        const userCfg = await env.ircBridge.getStore().getIrcClientConfig(userId, roomMapping.server);
        expect(userCfg.getUsername()).toEqual("foobar\"[]{}`_^");
    });

    it("should not be able to store an invalid username with !username", async function() {
        const sdk = env.clientMock._client(botUserId);

        const sendPromise = sdk.sendEvent.and.callFake(async (roomId, _, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual(
                "Username contained invalid characters not supported by IRC (\"\\u0001\")."
            );
            return {};
        });

        let userCfg = await env.ircBridge.getStore().getIrcClientConfig(userId, roomMapping.server);
        const defaultUsername = userCfg.getUsername();

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!username foo\x01bar",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        await sendPromise;
        userCfg = await env.ircBridge.getStore().getIrcClientConfig(userId, roomMapping.server);
        expect(userCfg.getUsername()).toEqual(defaultUsername); // unchanged
    });

    it("should be able to store a password with !storepass", async function() {
        const sdk = env.clientMock._client(botUserId);

        const sendPromise = sdk.sendEvent.and.callFake(async (roomId, _, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual(
                "Successfully stored password for irc.example. Use !reconnect to use this password now."
            );
            return {};
        });

        // Ensure that the user reconnects
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!storepass foobar",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        await sendPromise;
        const userCfg = await env.ircBridge.getStore().getIrcClientConfig(userId, roomMapping.server);
        expect(userCfg.getPassword()).toEqual("foobar");
    });

    it("should be able to store a username:password with !storepass", async function() {
        const password = "mynick:foopassword"
        const sdk = env.clientMock._client(botUserId);

        const sendPromise = sdk.sendEvent.and.callFake(async (roomId, _, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual(
                "Successfully stored password for irc.example. Use !reconnect to use this password now."
            );
            return {};
        });
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: `!storepass ${password}`,
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        await sendPromise;
        const userCfg = await env.ircBridge.getStore().getIrcClientConfig(userId, roomMapping.server);
        expect(userCfg.getPassword()).toEqual(password);
    });


    it("should be able to remove a password with !removepass", async function() {
        const sdk = env.clientMock._client(botUserId);

        let sendPromise = sdk.sendEvent.and.callFake(async (roomId, _, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual(
                "Successfully stored password for irc.example. Use !reconnect to use this password now."
            );
            return {};
        });

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!storepass foobar",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });

        sendPromise = sdk.sendEvent.and.callFake(async (roomId, _, content) => {
            expect(roomId).toEqual(adminRoomId);
            expect(content.msgtype).toEqual("m.notice");
            expect(content.body).toEqual("Successfully removed password.");
            return {};
        });

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "!removepass",
                msgtype: "m.text"
            },
            sender: userId,
            room_id: adminRoomId,
            type: "m.room.message"
        });
        await sendPromise;
    });
});
