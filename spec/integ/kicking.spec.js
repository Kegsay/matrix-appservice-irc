const envBundle = require("../util/env-bundle");

describe("Kicking", () => {

    const {env, config, test} = envBundle();

    const mxUser = {
        id: "@flibble:wibble",
        nick: "M-flibble"
    };

    const ircUser = {
        nick: "bob",
        localpart: config._server + "_bob",
        id: `@${config._server}_bob:${config.homeserver.domain}`
    };

    const ircUserKicker = {
        nick: "KickerNick",
        localpart: config._server + "_KickerNick",
        id: "@" + config._server + "_KickerNick:" + config.homeserver.domain
    };

    beforeEach(async () => {
        await test.beforeEach(env);

        // accept connection requests from eeeeeeeeveryone!
        env.ircMock._autoConnectNetworks(
            config._server, mxUser.nick, config._server
        );
        env.ircMock._autoConnectNetworks(
            config._server, ircUser.nick, config._server
        );
        env.ircMock._autoConnectNetworks(
            config._server, config._botnick, config._server
        );
        // accept join requests from eeeeeeeeveryone!
        env.ircMock._autoJoinChannels(
            config._server, mxUser.nick, config._chan
        );
        env.ircMock._autoJoinChannels(
            config._server, ircUser.nick, config._chan
        );
        env.ircMock._autoJoinChannels(
            config._server, config._botnick, config._chan
        );

        // we also don't care about registration requests for the irc user
        env.clientMock._intent(ircUser.id)._onHttpRegister({
            expectLocalpart: ircUser.localpart,
            returnUserId: ircUser.id
        });

        await test.initEnv(env);

        // make the matrix user be on IRC
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "let me in",
                msgtype: "m.text"
            },
            user_id: mxUser.id,
            room_id: config._roomid,
            type: "m.room.message"
        });
        const botIrcClient = await env.ircMock._findClientAsync(config._server, config._botnick);
        // make the IRC user be on Matrix
        botIrcClient.emit("message", ircUser.nick, config._chan, "let me in");
    });

    afterEach(async () => test.afterEach(env));

    describe("IRC users on IRC", () => {
        it("should make the kickee leave the Matrix room", async () => {
            const kickReason = "They had to go, they knew too much";
            const kickPromise = new Promise((resolve) => {
                const ircUserSdk = env.clientMock._client(ircUserKicker.id);
                ircUserSdk.kickUser.and.callFake((kickee, roomId, reason) => {
                    expect(roomId).toEqual(config._roomid);
                    expect(kickee).toEqual(ircUser.id);
                    expect(reason).toEqual(kickReason)
                    resolve();
                });
            });

            // send the KICK command
            const ircUserCli = await env.ircMock._findClientAsync(
                config._server, config._botnick
            );
            ircUserCli.emit("kick", config._chan, ircUser.nick, ircUserKicker.nick, kickReason);
            await kickPromise;
        });
    });

    describe("Matrix users on Matrix", () => {
        it("should make the kickee part the IRC channel", async () => {
            let parted = false;
            env.ircMock._whenClient(config._server, mxUser.nick, "part",
            function(client, channel, msg, cb) {
                expect(client.nick).toEqual(mxUser.nick);
                expect(client.addr).toEqual(config._server);
                expect(channel).toEqual(config._chan);
                expect(msg.indexOf("@the_kicker:localhost")).not.toEqual(-1,
                    "Part message doesn't contain kicker's user ID");
                parted = true;
                client._invokeCallback(cb);
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "leave"
                },
                user_id: "@the_kicker:localhost",
                state_key: mxUser.id,
                room_id: config._roomid,
                type: "m.room.member"
            });
            expect(parted).toBe(true, "Didn't part");
        });
    });

    describe("Matrix users on IRC", function() {
        it("should make the AS bot kick the Matrix user from the Matrix room", async () => {
            let userKickedPromise = new Promise(function(resolve) {
                // assert function call when the bot attempts to kick
                let botSdk = env.clientMock._client(config._botUserId);
                botSdk.kickUser.and.callFake(function(userId, roomId, reason) {
                    expect(roomId).toEqual(config._roomid);
                    expect(userId).toEqual(mxUser.id);
                    expect(reason.indexOf("KickerNick")).not.toEqual(-1,
                        "Reason doesn't contain the kicker's nick");
                    resolve();
                });
            });

            // send the KICK command
            let botCli = await env.ircMock._findClientAsync(
                config._server, config._botnick
            );
            botCli.emit("kick", config._chan, mxUser.nick, "KickerNick", "Reasons");
            await userKickedPromise;
        });
    });

    describe("IRC users on Matrix", () => {
        it("should make the virtual IRC client KICK the real IRC user", async () => {
            let reason = "they are a fish";
            let userKickedPromise = new Promise(function(resolve, reject) {
                env.ircMock._whenClient(config._server, mxUser.nick, "send",
                function(client, cmd, chan, nick, kickReason) {
                    expect(client.nick).toEqual(mxUser.nick);
                    expect(client.addr).toEqual(config._server);
                    expect(nick).toEqual(ircUser.nick);
                    expect(chan).toEqual(config._chan);
                    expect(cmd).toEqual("KICK");
                    expect(kickReason.indexOf(reason)).not.toEqual(-1,
                        `kick reason was not mirrored to IRC. Got '${kickReason}',
                        expected '${reason}'.`);
                    resolve();
                });
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    reason: reason,
                    membership: "leave"
                },
                user_id: mxUser.id,
                state_key: ircUser.id,
                room_id: config._roomid,
                type: "m.room.member"
            });
            await userKickedPromise;
        });
    });
});


describe("Banning", () => {

    const {env, config, test} = envBundle();

    const mxUser = {
        id: "@flibble:wibble",
        nick: "M-flibble"
    };

    const ircUser = {
        nick: "bob",
        localpart: config._server + "_bob",
        id: `@${config._server}_bob:${config.homeserver.domain}`
    };

    const ircUserKicker = {
        nick: "KickerNick",
        localpart: config._server + "_KickerNick",
        id: "@" + config._server + "_KickerNick:" + config.homeserver.domain
    };

    beforeEach(async () => {
        await test.beforeEach(env);

        // accept connection requests from eeeeeeeeveryone!
        env.ircMock._autoConnectNetworks(
            config._server, mxUser.nick, config._server
        );
        env.ircMock._autoConnectNetworks(
            config._server, ircUser.nick, config._server
        );
        env.ircMock._autoConnectNetworks(
            config._server, config._botnick, config._server
        );
        // accept join requests from eeeeeeeeveryone!
        env.ircMock._autoJoinChannels(
            config._server, mxUser.nick, config._chan
        );
        env.ircMock._autoJoinChannels(
            config._server, ircUser.nick, config._chan
        );
        env.ircMock._autoJoinChannels(
            config._server, config._botnick, config._chan
        );

        // we also don't care about registration requests for the irc user
        env.clientMock._intent(ircUser.id)._onHttpRegister({
            expectLocalpart: ircUser.localpart,
            returnUserId: ircUser.id
        });

        await test.initEnv(env);

        // make the matrix user be on IRC
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "let me in",
                msgtype: "m.text"
            },
            user_id: mxUser.id,
            room_id: config._roomid,
            type: "m.room.message"
        });
        const botIrcClient = await env.ircMock._findClientAsync(config._server, config._botnick);
        // make the IRC user be on Matrix
        botIrcClient.emit("message", ircUser.nick, config._chan, "let me in");
    });

    afterEach(async () => test.afterEach(env));

    describe("IRC users on Matrix", () => {
        it("should make the virtual IRC client set MODE +b and KICK the real IRC user", async () => {
            let reason = "Get some help.";
            let userBannedPromise = new Promise(function(resolve, reject) {
                env.ircMock._whenClient(config._server, mxUser.nick, "send",
                function(client, cmd, chan, arg1, arg2) {
                    expect(client.nick).toEqual(mxUser.nick);
                    expect(client.addr).toEqual(config._server);
                    expect(chan).toEqual(config._chan);
                    if (cmd !== "KICK") {
                        // We sent a MODE
                        expect(cmd).toEqual("MODE");
                        expect(arg1).toEqual("+b"); // mode +b => ban
                        expect(arg2).toEqual(`${ircUser.nick}!*@*`); // argument to +b
                    }
                    else {
                        expect(cmd).toEqual("KICK");
                        expect(arg1).toEqual(ircUser.nick); // nick
                        expect(arg2.indexOf(reason)).not.toEqual(-1, // kick reason
                            `kick reason was not mirrored to IRC. Got '${arg2}',
                            expected '${reason}'.`);
                    }
                    resolve();
                });
            });

            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    reason: reason,
                    membership: "ban"
                },
                user_id: mxUser.id,
                state_key: ircUser.id,
                room_id: config._roomid,
                type: "m.room.member"
            });
            await userBannedPromise;
        });
    });
});


describe("Kicking on IRC join", () => {
    const {env, config, test} = envBundle();

    const mxUser = {
        id: "@flibble:wibble",
        nick: "M-flibble"
    };

    const ircUser = {
        nick: "bob",
        localpart: config._server + "_bob",
        id: `@${config._server}_bob:${config.homeserver.domain}`,
    };

    beforeEach(async () => {
        await test.beforeEach(env);
        config.ircService.servers[config._server].membershipLists.enabled = true;
        config.ircService.servers[
            config._server
        ].membershipLists.global.matrixToIrc.incremental = true;

        // accept connection requests from eeeeeeeeveryone!
        env.ircMock._autoConnectNetworks(
            config._server, mxUser.nick, config._server
        );
        env.ircMock._autoConnectNetworks(
            config._server, ircUser.nick, config._server
        );
        env.ircMock._autoConnectNetworks(
            config._server, config._botnick, config._server
        );
        // accept join requests from eeeeeeeeveryone!
        env.ircMock._autoJoinChannels(
            config._server, mxUser.nick, config._chan
        );
        env.ircMock._autoJoinChannels(
            config._server, ircUser.nick, config._chan
        );
        env.ircMock._autoJoinChannels(
            config._server, config._botnick, config._chan
        );

        // we also don't care about registration requests for the irc user
        env.clientMock._intent(ircUser.id)._onHttpRegister({
            expectLocalpart: ircUser.localpart,
            returnUserId: ircUser.id
        });

        await test.initEnv(env);
    });

    afterEach(async () => test.afterEach(env));

    it("should be done for err_needreggednick", async () => {
        const userKickedPromise = new Promise(function(resolve) {
            // assert function call when the bot attempts to kick
            let botSdk = env.clientMock._client(config._botUserId);
            botSdk.kickUser.and.callFake(function(userId, roomId, reason) {
                expect(roomId).toEqual(config._roomid);
                expect(userId).toEqual(mxUser.id);
                resolve();
            });
        });

        // when the matrix user tries to join the channel, error them.
        const ircErrorPromise = new Promise((resolve) => {
            env.ircMock._whenClient(config._server, mxUser.nick, "join",
            function(client, channel, msg, cb) {
                expect(client.nick).toEqual(mxUser.nick);
                expect(client.addr).toEqual(config._server);
                expect(channel).toEqual(config._chan);
                client.emit("error", {
                    command: "err_needreggednick",
                    args: [config._chan]
                });
                resolve();
            });
        });


        // make matrix user attempt to join the channel
        try {
            await env.mockAppService._trigger("type:m.room.member", {
                content: {
                    membership: "join"
                },
                user_id: mxUser.id,
                state_key: mxUser.id,
                room_id: config._roomid,
                type: "m.room.member"
            });
        }
        catch (err) {
            // ignore, other promises check what should happen
        }

        // wait for the error to be sent
        await ircErrorPromise;

        // wait for the bridge to kick the matrix user
        await userKickedPromise;
    });
});
