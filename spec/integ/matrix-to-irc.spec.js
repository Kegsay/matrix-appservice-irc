/*
 * Contains integration tests for all Matrix-initiated events.
 */

const envBundle = require("../util/env-bundle");
const mediaUrl = "http://some-media-repo.com";


function constructHTMLReply(sourceText, sourceUser, reply) {
    // This is one hella ugly format.
    return "<mx-reply><blockquote><a href=\"https://some.link\">In reply to</a>" +
    `<a href=\"https://some.user">${sourceUser}</a><br`+
    `><p>${sourceText}</p></blockquote></mx-reply>${reply}`;
}

describe("Matrix-to-IRC message bridging", function() {

    const {env, config, roomMapping, test} = envBundle();

    const testUser = {
        id: "@flibble:wibble",
        nick: "M-flibble"
    };

    const repliesUser = {
        id: "@friend:bar.com",
        nick: "M-friend",
    };

    beforeEach(async () => {
        await test.beforeEach(env);

        // accept connection requests
        [testUser, repliesUser].forEach((u) => {
            env.ircMock._autoConnectNetworks(
                roomMapping.server, u.nick, roomMapping.server
            );
            env.ircMock._autoJoinChannels(
                roomMapping.server, u.nick, roomMapping.channel
            );
        });

        env.ircMock._autoConnectNetworks(
            roomMapping.server, roomMapping.botNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, roomMapping.botNick, roomMapping.channel
        );

        await test.initEnv(env);
    });

    afterEach(async () => test.afterEach(env));

    it("should bridge matrix messages as IRC text", function(done) {
        const testText = "Here is some test text.";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "say", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(testText.length);
            expect(text).toEqual(testText);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testText,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge formatted matrix messages as formatted IRC text", (done) => {
        const tFormattedBody = "I support <em>em</em>, <strong>strong bold</strong> and <b>" +
        'normal bold</b> and <b>bold <u>and underline</u><font color="green"> ' +
        "including green</font></b>";
        const tFallback = "I support em, strong bold and normal bold and " +
        "bold and underline including green";
        const tIrcBody = "I support \u001dem\u000f, \u0002strong bold\u000f and \u0002normal bold" +
        "\u000f and \u0002bold \u001fand underline\u000f\u0002\u000303 including" +
        " green\u000f\u0002\u000f"; // last 2 codes not necessary!

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "say", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(tIrcBody.length);
            expect(text).toEqual(tIrcBody);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tFallback,
                format: "org.matrix.custom.html",
                formatted_body: tFormattedBody,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge escaped HTML matrix messages as unescaped HTML", (done) => {
        const tFormattedBody = "<p>this is a &quot;test&quot; &amp; some _ mo!re" +
        " fun ch@racters... are &lt; included &gt; here.</p>";
        const tFallback = "this is a \"test\" & some _ mo!re fun ch@racters... " +
        "are < included > here.";
        const tIrcBody = "this is a \"test\" & some _ mo!re fun ch@racters... " +
        "are < included > here.";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "say", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(tIrcBody.length);
            expect(text).toEqual(tIrcBody);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tFallback,
                format: "org.matrix.custom.html",
                formatted_body: tFormattedBody,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should strip out unknown html tags from formatted_body", function(done) {
        const tFormattedBody = "Here is <foo bar=\"tar\">baz text</foo>";
        const tFallback = "Here is baz text";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "say", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(tFallback.length);
            expect(text).toEqual(tFallback);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tFallback,
                format: "org.matrix.custom.html",
                formatted_body: tFormattedBody,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    // to prevent formatting text like * from being dropped on the floor IRC side
    it("should use the fallback text if there are unrecognised tags", function(done) {
        const tFormattedBody = "Here is <foo>baz</foo> text";
        const tFallback = "Here is *baz* text";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "say", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.length).toEqual(tFallback.length);
            expect(text).toEqual(tFallback);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tFallback,
                format: "org.matrix.custom.html",
                formatted_body: tFormattedBody,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge matrix emotes as IRC actions", function(done) {
        let testEmote = "thinks";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "action", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text).toEqual(testEmote);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testEmote,
                msgtype: "m.emote"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge matrix notices as IRC notices", function(done) {
        const testNotice = "Some automated message";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "notice", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text).toEqual(testNotice);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testNotice,
                msgtype: "m.notice"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge rapid matrix replies as short replies", async () => {
        // Trigger an original event
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "This is the real message",
                msgtype: "m.text"
            },
            room_id: roomMapping.roomId,
            sender: repliesUser.id,
            event_id: "$original:bar.com",
            origin_server_ts: Date.now(),
            type: "m.room.message"
        });
        const p = env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
            (client, channel, text) => {
                expect(client.nick).toEqual(testUser.nick);
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                expect(text).toEqual(`${repliesUser.nick}: Reply Text`);
            }
        );
        const formatted_body = constructHTMLReply(
            "This is the fake message",
            "@somedude:bar.com",
            "Reply text"
        );
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <@somedude:bar.com> This is the fake message\n\nReply Text",
                formatted_body,
                format: "org.matrix.custom.html",
                msgtype: "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$original:bar.com"
                    }
                },
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            origin_server_ts: Date.now(),
            type: "m.room.message"
        });
        await p;
    });

    it("should bridge slow matrix replies as long replies", async () => {
        // Trigger an original event
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "This is the real message",
                msgtype: "m.text"
            },
            room_id: roomMapping.roomId,
            sender: repliesUser.id,
            event_id: "$original:bar.com",
            origin_server_ts: Date.now(),
            type: "m.room.message"
        });
        const p = env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
            (client, channel, text) => {
                expect(client.nick).toEqual(testUser.nick);
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                expect(text).toEqual(`<${repliesUser.nick}> "This is the real message" <- Reply Text`);
            }
        );
        const formatted_body = constructHTMLReply(
            "This is the fake message",
            "@somedude:bar.com",
            "Reply text"
        );
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <@somedude:bar.com> This is the fake message\n\nReply Text",
                formatted_body,
                format: "org.matrix.custom.html",
                msgtype: "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$original:bar.com"
                    }
                },
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            origin_server_ts: Date.now() + 1_000_000,
            type: "m.room.message"
        });
        await p;
    });

    it("should bridge matrix replies which contain displaynames", async () => {
        // Trigger an original event
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "This is the real message",
                msgtype: "m.text"
            },
            room_id: roomMapping.roomId,
            sender: repliesUser.id,
            event_id: "$original:bar.com",
            type: "m.room.message"
        });
        const p = env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
            (client, channel, text) => {
                expect(client.nick).toEqual(testUser.nick);
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                // We use the nick over the displayname
                expect(text).toEqual(`M-friend: Reply Text`);
            }
        );
        const formatted_body = constructHTMLReply(
            "This is the fake message",
            "SomeDude",
            "Reply text"
        );
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <SomeDude> This is the fake message\n\nReply Text",
                formatted_body,
                format: "org.matrix.custom.html",
                msgtype: "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$original:bar.com"
                    }
                },
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
        await p;
    });

    it("should bridge matrix replies as roughly formatted text, newline edition", async () => {
        // Trigger an original event
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "\nThis\n is the real message",
                msgtype: "m.text"
            },
            room_id: roomMapping.roomId,
            sender: repliesUser.id,
            event_id: "$original:bar.com",
            origin_server_ts: Date.now(),
            type: "m.room.message"
        });
        const p = env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
            (client, channel, text) => {
                expect(client.nick).toEqual(testUser.nick);
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                expect(text).toEqual(`<${repliesUser.nick}> "This..." <- Reply Text`);
            }
        );
        const formatted_body = constructHTMLReply(
            "This is the fake message",
            "@somedude:bar.com",
            "Reply text"
        );
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <@somedude:bar.com> This is the fake message\n\nReply Text",
                formatted_body,
                format: "org.matrix.custom.html",
                msgtype: "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$original:bar.com"
                    }
                },
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            origin_server_ts: Date.now() + 1_000_000,
            type: "m.room.message"
        });
        await p;
    });

    it("should bridge matrix replies as reply only, if source not found", async () => {
        const p = env.ircMock._whenClient(roomMapping.server, testUser.nick, "say", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text).toEqual('Reply Text');
        });
        const formatted_body = constructHTMLReply(
            "This message is possibly fake",
            "@somedude:bar.com",
            "Reply Text"
        );

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <@somedude:bar.com> This message is possibly fake\n\nReply Text",
                msgtype: "m.text",
                formatted_body,
                format: "org.matrix.custom.html",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$original:bar.com"
                    }
                },
            },
            formatted_body,
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
        await p;
    });

    it("should bridge matrix replies to replies without the original source", async () => {
        let formatted_body = constructHTMLReply(
            "Message #1",
            "@somedude:bar.com",
            "Message #2"
        );

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "Message #1",
                msgtype: "m.text"
            },
            room_id: roomMapping.roomId,
            sender: repliesUser.id,
            event_id: "$first:bar.com",
            origin_server_ts: Date.now(),
            type: "m.room.message"
        })

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <@friend:bar.com> Message#1\n\nMessage #2",
                formatted_body,
                format: "org.matrix.custom.html",
                msgtype: "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$first:bar.com"
                    }
                },
            },
            room_id: roomMapping.roomId,
            sender: repliesUser.id,
            event_id: "$second:bar.com",
            origin_server_ts: Date.now() + 1_000_000,
            type: "m.room.message"
        });

        formatted_body = constructHTMLReply(
            "Message #2",
            "@somedude:bar.com",
            "Message #3"
        );

        const p = env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
            function(client, channel, text) {
                expect(client.nick).toEqual(testUser.nick);
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                expect(text).toEqual('<M-friend> "Message #2" <- Message #3');
            }
        );

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <@friend:bar.com> Message#2\n\nMessage #3",
                formatted_body,
                format: "org.matrix.custom.html",
                msgtype: "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$second:bar.com"
                    }
                },
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            origin_server_ts: Date.now() + 2_000_000,
            type: "m.room.message"
        });

        await p;
    });

    it("should bridge matrix replies to ghosts with their nick", async () => {
        // Trigger an original event
        const originalMessage = {
            content: {
                body: "This is the real message",
                msgtype: "m.text"
            },
            room_id: roomMapping.roomId,
            sender: "@irc.example_WibbleWob:some.home.server",
            event_id: "$original32:bar.com",
            type: "m.room.message"
        };
        const botSdk = env.clientMock._client(config._botUserId);
        botSdk.getEvent.and.callFake(async (roomId, eventId) => {
            expect(roomId).toBe(roomMapping.roomId);
            expect(eventId).toBe("$original32:bar.com");
            return originalMessage;
        });
        const p = env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
            function(client, channel, text) {
                expect(client.nick).toEqual(testUser.nick);
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                expect(text).toEqual('WibbleWob: Reply Text');
            }
        );
        const formatted_body = constructHTMLReply(
            "This is the fake message",
            "@somedude:bar.com",
            "Reply text"
        );
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <@somedude:bar.com> This is the fake message\n\nReply Text",
                formatted_body,
                format: "org.matrix.custom.html",
                msgtype: "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$original32:bar.com"
                    }
                },
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
        await p;
    });

    it("should bridge multiline matrix replies without losing information (GH-1198)", async () => {
        // Trigger an original event
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "This is the real message",
                msgtype: "m.text"
            },
            room_id: roomMapping.roomId,
            sender: repliesUser.id,
            event_id: "$original:bar.com",
            origin_server_ts: 1_000,
            type: "m.room.message"
        });
        const p = env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
            (client, channel, text) => {
                expect(client.nick).toEqual(testUser.nick);
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                expect(text).toContain('Line one');
                expect(text).toContain('Line two');
            }
        );
        const formatted_body = constructHTMLReply(
            "This is the fake message",
            "@somedude:bar.com",
            "Line one<br>Line two"
        );
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: "> <@somedude:bar.com> This is the fake message\n\nLine one\nLine two",
                formatted_body,
                format: "org.matrix.custom.html",
                msgtype: "m.text",
                "m.relates_to": {
                    "m.in_reply_to": {
                        "event_id": "$original:bar.com"
                    }
                },
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            origin_server_ts: 2_000,
            type: "m.room.message"
        });
        await p;
    });

    it("should truncate multiline messages and include a full message URL", function(done) {
        const tBody = "This\nis\na\nmessage\nwith\nmultiple\nline\nbreaks".split('\n');
        const sdk = env.clientMock._client(config._botUserId);

        sdk.uploadContent.and.returnValue(Promise.resolve("mxc://deadbeefcafe"));

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "say", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            // don't be too brittle when checking this, but I expect to see the
            // start of the first line and the media proxy url
            expect(text.indexOf(tBody[0])).toEqual(0);
            expect(text.indexOf(tBody[1])).not.toEqual(0);
            expect(text.includes(config.ircService.mediaProxy.publicUrl)).toEqual(true);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody.join("\n"),
                msgtype: "m.text"
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge mutliline code blocks as IRC action with URL", function(done) {
        let tBody =
            "```javascript\n" +
            "    expect(text.indexOf(\"javascript\")).not.toEqual(-1);\n" +
            "    expect(text.indexOf(tHsUrl)).not.toEqual(-1);\n" +
            "    expect(text.indexOf(tMxcSegment)).not.toEqual(-1);\n" +
            "    done();\n" +
            "```";

        const sdk = env.clientMock._client(config._botUserId);
        sdk.uploadContent.and.returnValue(Promise.resolve("mxc://deadbeefcafe"));

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "action", (client, channel, text) => {
                expect(client.nick).toEqual(testUser.nick);
                expect(client.addr).toEqual(roomMapping.server);
                expect(channel).toEqual(roomMapping.channel);
                // don't be too brittle when checking this, but I expect to see the
                // code type and the media proxy url
                expect(text.indexOf('javascript')).not.toEqual(-1);
                expect(text.includes(config.ircService.mediaProxy.publicUrl)).toEqual(true);
                done();
            });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should truncate multiline notices just like messages", function(done) {
        const tBody = "This\nis\na\nmessage\nwith\nmultiple\nline\nbreaks".split('\n');
        const sdk = env.clientMock._client(config._botUserId);

        sdk.uploadContent.and.returnValue(Promise.resolve("mxc://deadbeefcafe"));

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "notice", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            // don't be too brittle when checking this, but I expect to see the
            // start of the first line and the media proxy URL
            expect(text.indexOf(tBody[0])).toEqual(0);
            expect(text.indexOf(tBody[1])).not.toEqual(0);
            expect(text.includes(config.ircService.mediaProxy.publicUrl)).toEqual(true);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody.join("\n"),
                msgtype: "m.notice"
            },
            sender: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge matrix images as IRC action with a URL", function(done) {
        const tBody = "the_image.jpg";
        const tMxcSegment = "/somecontentid";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "action", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.includes(config.ircService.mediaProxy.publicUrl)).toEqual(true);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody,
                url: "mxc://" + tMxcSegment,
                msgtype: "m.image"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge matrix files as IRC action with a URL", function(done) {
        const tBody = "a_file.apk";
        const tMxcSegment = "/somecontentid";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "action", (client, channel, text) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.includes(config.ircService.mediaProxy.publicUrl)).toEqual(true);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody,
                url: "mxc://" + tMxcSegment,
                msgtype: "m.file"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should bridge matrix topics as IRC topics", function(done) {
        const testTopic = "Topics are amazingz";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "send", (client, command, channel, data) => {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(command).toEqual("TOPIC");
            expect(channel).toEqual(roomMapping.channel);
            expect(data).toEqual(testTopic);
            done();
        });

        env.mockAppService._trigger("type:m.room.topic", {
            content: {
                topic: testTopic
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            state_key: "",
            type: "m.room.topic"
        });
    });
});

describe("Matrix-to-Matrix message bridging", function() {

    const {env, config, roomMapping, test} = envBundle();

    let testUser = {
        id: "@flibble:" + config.homeserver.domain,
        nick: "M-flibble"
    };
    let secondRoomId = "!second:roomid";
    let mirroredUserId =`@${roomMapping.server}_${testUser.nick}:${config.homeserver.domain}`;

    beforeEach(async () => {
        await test.beforeEach(env);

        // accept connection requests
        env.ircMock._autoConnectNetworks(
            roomMapping.server, testUser.nick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, testUser.nick, roomMapping.channel
        );
        env.ircMock._autoConnectNetworks(
            roomMapping.server, roomMapping.botNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, roomMapping.botNick, roomMapping.channel
        );

        // Add in a 2nd mapping so it's #chan => [ !one:bar, !two:bar ]
        config.ircService.servers[roomMapping.server].mappings = {
            [roomMapping.channel]: { roomIds: [roomMapping.roomId, secondRoomId] }
        };

        // Let the virtual matrix user register
        let botSdk = env.clientMock._intent(config._botUserId);
        botSdk._onHttpRegister({
            expectLocalpart: roomMapping.server + "_" + testUser.nick,
            returnUserId: mirroredUserId
        });

        await test.initEnv(env);
    });

    afterEach(async () => test.afterEach(env));

    it("should bridge matrix messages to other mapped matrix rooms", async () => {
        let testText = "Here is some test text.";
        const sdk = env.clientMock._client(mirroredUserId);
        sdk.sendEvent.and.callFake(function(roomId, type, content) {
            expect(roomId).toEqual(secondRoomId);
            expect(content).toEqual({
                body: testText,
                msgtype: "m.text"
            });
            return Promise.resolve();
        });

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testText,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });

    it("should NOT bridge matrix messages to other mapped matrix rooms for PMs",
    async () => {
        // Set up two PM rooms between:
        // testUser ==> NickServ (room A)
        // anotherUser ==> NickServ (room B)
        // Send a message in one room. It should not be mapped through.
        const nickServUserId = `@${roomMapping.server}_nickserv:${config.homeserver.domain}`;
        const pmRoomIdA = "!private:room";
        const pmRoomIdB = "!private:room2";
        const anotherUserId = "@someotherguy:wibble";

        // Let nickserv virtual matrix user register, join rooms and get state
        const intent = env.clientMock._intent(config._botUserId);
        intent._onHttpRegister({
            expectLocalpart: `${roomMapping.server}_nickserv`,
            returnUserId: nickServUserId
        });

        let joinedRooms = new Set();
        let nickservSdk = env.clientMock._client(nickServUserId);
        nickservSdk.joinRoom.and.callFake(function(roomId) {
            joinedRooms.add(roomId);
            return Promise.resolve({});
        });
        nickservSdk.getRoomState.and.callFake(function(roomId) {
            let uid = roomId === pmRoomIdA ? testUser.id : anotherUserId;
            return Promise.resolve([
                {
                    content: {membership: "join"},
                    user_id: nickServUserId,
                    state_key: nickServUserId,
                    room_id: roomId,
                    type: "m.room.member"
                },
                {
                    content: {membership: "join"},
                    user_id: uid,
                    state_key: uid,
                    room_id: roomId,
                    type: "m.room.member"
                }
            ]);
        });

        // Get nick serv into the 2 PM rooms
        await env.mockAppService._trigger("type:m.room.member", {
            content: {
                membership: "invite",
                is_direct: true
            },
            state_key: nickServUserId,
            user_id: testUser.id,
            room_id: pmRoomIdA,
            type: "m.room.member"
        });
        await env.mockAppService._trigger("type:m.room.member", {
            content: {
                membership: "invite",
                is_direct: true
            },
            state_key: nickServUserId,
            user_id: anotherUserId,
            room_id: pmRoomIdB,
            type: "m.room.member"
        });
        expect(joinedRooms.has(pmRoomIdA)).toBe(true);
        expect(joinedRooms.has(pmRoomIdB)).toBe(true);

        // Send a message in one room. Make sure it does not go to the other room.
        let testText = "Here is some test text.";
        const sdk = env.clientMock._client(mirroredUserId);
        sdk.sendEvent.and.callFake(function(roomId, type, content) {
            expect(true).toBe(
                false, "Bridge incorrectly tried to send a matrix event into room " + roomId
            );
            return Promise.resolve();
        });

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: testText,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: pmRoomIdA,
            type: "m.room.message"
        });
    });
});

describe("Matrix-to-IRC message bridging with media URL and drop time", function() {

    const {env, config, roomMapping, test} = envBundle();

    let testUser = {
        id: "@flibble:wibble",
        nick: "M-flibble"
    };

    beforeEach(async () => {
        env.config.homeserver.dropMatrixMessagesAfterSecs = 300; // 5 min
        jasmine.clock().install();

        await test.beforeEach(env);

        // accept connection requests
        env.ircMock._autoConnectNetworks(
            roomMapping.server, testUser.nick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, testUser.nick, roomMapping.channel
        );
        env.ircMock._autoConnectNetworks(
            roomMapping.server, roomMapping.botNick, roomMapping.server
        );
        env.ircMock._autoJoinChannels(
            roomMapping.server, roomMapping.botNick, roomMapping.channel
        );

        await test.initEnv(env);
        // Set the media URL
        env.ircBridge.matrixHandler.mediaUrl = mediaUrl;
    });

    afterEach(async () => {
        jasmine.clock().uninstall();
        await test.afterEach(env);
    });

    it("should NOT bridge old matrix messages older than the drop time", async () => {
        let tBody = "Hello world";

        let said = false;
        env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
        function(client, channel, text) {
            said = true;
        });

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message",
            origin_server_ts: Date.now() - (1000 * 60 * 6), // 6 mins old
        });

        expect(said).toBe(false);
    });

    it("should NOT bridge old matrix messages younger than the drop time on receive, which " +
    "then go over the drop time whilst processing", async () => {
        const tBody = "Hello world";
        const testUser2 = {
            id: "@tester:wibble",
            nick: "M-tester"
        };
        jasmine.clock().mockDate();

        let said = false;
        env.ircMock._whenClient(roomMapping.server, testUser2.nick, "say",
        function(client, channel, text) {
            said = true;
        });

        let connected = false;
        env.ircMock._whenClient(roomMapping.server, testUser2.nick, "connect",
        function(client, cb) {
            // advance 20s to take it over dropMatrixMessagesAfterSecs time
            jasmine.clock().tick(20 * 1000);
            client._invokeCallback(cb);
            connected = true;
        });

        env.ircMock._autoJoinChannels(
            roomMapping.server, testUser2.nick, roomMapping.channel
        );
        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody,
                msgtype: "m.text"
            },
            user_id: testUser2.id,
            room_id: roomMapping.roomId,
            type: "m.room.message",
            origin_server_ts: Date.now() - (1000 * 60 * 4) - (1000 * 50), // 4m50s old
        });

        expect(connected).toBe(true);
        expect(said).toBe(false);
    });

    it("should bridge old matrix messages younger than the drop time", async () => {
        let tBody = "Hello world";

        let said = false;
        env.ircMock._whenClient(roomMapping.server, testUser.nick, "say",
        function(client, channel, text) {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text).toEqual(tBody);
            said = true;
        });

        await env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody,
                msgtype: "m.text"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message",
            origin_server_ts: Date.now() - (1000 * 60 * 4), // 4 mins old
        });

        expect(said).toBe(true);
    });

    it("should bridge matrix files as IRC action with a configured media URL", function(done) {
        let tBody = "a_file.apk";
        let tMxcSegment = "/somecontentid";

        env.ircMock._whenClient(roomMapping.server, testUser.nick, "action",
        function(client, channel, text) {
            expect(client.nick).toEqual(testUser.nick);
            expect(client.addr).toEqual(roomMapping.server);
            expect(channel).toEqual(roomMapping.channel);
            expect(text.includes(config.ircService.mediaProxy.publicUrl)).toEqual(true);
            done();
        });

        env.mockAppService._trigger("type:m.room.message", {
            content: {
                body: tBody,
                url: "mxc://" + tMxcSegment,
                msgtype: "m.file"
            },
            user_id: testUser.id,
            room_id: roomMapping.roomId,
            type: "m.room.message"
        });
    });
});
