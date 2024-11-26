"use strict";
const Promise = require("bluebird");
const { MatrixUser } = require("matrix-appservice-bridge");
const { IdentGenerator } = require("../../lib/irc/IdentGenerator");
const { IrcClientConfig } = require("../../lib/models/IrcClientConfig");

const IRC_DOMAIN = "somedomain.com";

describe("Username generation", function() {
    let identGenerator;
    let storeMock;
    let ircClientConfig;
    let ircClientConfigs;
    let ircClientConfigsUsername;
    let ircClientConfigsUsernames;
    const serverMock = {
        getRealNameFormat: () => "mxid",
        getIpv6Only: () => false,
    };

    beforeEach(function() {
        ircClientConfigs = { };
        ircClientConfigsUsername = { };
        ircClientConfigsUsernames = [];
        storeMock = {};
        var _uname;
        ircClientConfig = {
            getDesiredNick: () => { return "MyCrazyNick"; },
            getDomain: () => IRC_DOMAIN,
            getUsername: () => {
                return _uname;
            },
            getUserId: function() {},
            setUsername: function(u) {
                _uname = u;
            }
        };
        storeMock.getCountForUsernamePrefix = async function (domain, usernamePrefix) {
            return ircClientConfigsUsernames.filter((uname) =>
                uname.startsWith(usernamePrefix)
            ).length;
        }
        storeMock.getMatrixUserByUsername = async function(domain, uname) {
            var obj;
            if (ircClientConfigsUsername[uname+domain]) {
                return new MatrixUser(ircClientConfigsUsername[uname+domain].getUserId());
            }
            return obj;
        };
        storeMock.getIrcClientConfig = async (sender, domain) => ircClientConfigs[sender+domain];
        storeMock.storeIrcClientConfig = async (config) => {
            ircClientConfigs[config.userId+config.domain] = config;
            ircClientConfigsUsername[config.getUsername()+config.domain] = config;
            ircClientConfigsUsernames.push(config.getUsername());
        }

        identGenerator = new IdentGenerator(storeMock);
        IdentGenerator.MAX_USER_NAME_LENGTH = 8;
    });

    it("should attempt to truncate the user ID on a long user ID", async function() {
        var userId = "@myreallylonguseridhere:localhost";
        var uname = "myreally";
        const info = await identGenerator.getIrcNames(ircClientConfig, serverMock, new MatrixUser(userId));
        expect(info.username).toEqual(uname);
    });

    it("should reverse the userID according to legacy format", async function() {
        var userId = "@myreallylonguseridhere:localhost";
        const info = await identGenerator.getIrcNames(ircClientConfig, {
            getRealNameFormat: () => "reverse-mxid",
            getIpv6Only: () => false
        }, new MatrixUser(userId));
        expect(info.realname).toEqual("localhost:myreallylonguseridhere");
    });

    it("should allow template userID", async function() {
        var userId = "@mxuser:localhost";
        const user = new MatrixUser(userId);
        user.setDisplayName('bar');
        ircClientConfig.getUsername = () => 'foo';
        let info = await identGenerator.getIrcNames(ircClientConfig, {
            getRealNameFormat: () => "$USERID_$REVERSEID_suffix",
        }, user);
        expect(info.realname).toEqual("@mxuser:localhost_localhost:mxuser_suffix");
        info = await identGenerator.getIrcNames(ircClientConfig, {
            getRealNameFormat: () => "$IRCUSER_$DISPLAY_$LOCALPART_suffix",
        }, user);
        expect(info.realname).toEqual("foo_bar_mxuser_suffix");
    });

    it("should start with '_1' on an occupied user ID", async function() {
        const userId = "@myreallylonguseridhere:localhost";
        const uname = "myreal_1";
        storeMock.storeIrcClientConfig(new IrcClientConfig("@someone:else", IRC_DOMAIN, { username: "myreally" }));
        const info = await identGenerator.getIrcNames(ircClientConfig, serverMock, new MatrixUser(userId));
        expect(info.username).toEqual(uname);
    });

    it("should loop from '_9' to '_10' and keep the same total length", async function() {
        const userId = "@myreallylonguseridhere:localhost";
        const uname = "myrea_10";
        storeMock.storeIrcClientConfig(new IrcClientConfig("@someone:else", IRC_DOMAIN, { username: "myreally" }));
        for (let i = 1; i < 10; i++) {
            storeMock.storeIrcClientConfig(
                new IrcClientConfig(`@someone${i}:else`, IRC_DOMAIN, { username: "myreal_" + i })
            );
        }
        const info = await identGenerator.getIrcNames(ircClientConfig, serverMock, new MatrixUser(userId));
        expect(info.username).toEqual(uname);
    });

    it("should loop from '_1' to '_2' and keep the same total length", async function() {
        const userId = "@myreallylonguseridhere:localhost";
        const uname = "myreal_2";
        storeMock.storeIrcClientConfig(new IrcClientConfig("@someone:else", IRC_DOMAIN, { username: "myreally" }));
        storeMock.storeIrcClientConfig(new IrcClientConfig("@someone1:else", IRC_DOMAIN, { username: "myreal_1" }));
        const info = await identGenerator.getIrcNames(ircClientConfig, serverMock, new MatrixUser(userId));
        expect(info.username).toEqual(uname);
    });

    it("should eventually give up trying usernames", async function() {
        IdentGenerator.MAX_USER_NAME_LENGTH = 3;
        storeMock.getMatrixUserByUsername = function() {
            return Promise.resolve({getId: function() { return "@someone:else"} });
        };
        const userId = "@myreallylonguseridhere:localhost";
        try {
            await identGenerator.getIrcNames(ircClientConfig, serverMock, new MatrixUser(userId));
        }
        catch (ex) {
            return;
        }
        throw Error("Promise was unexpectedly resolved");
    });

    it("should prefix 'M' onto usernames which don't begin with A-z", async function() {
        const userId = "@-myname:localhost";
        const uname = "M-myname";
        const info = await identGenerator.getIrcNames(ircClientConfig, serverMock, new MatrixUser(userId));
        expect(info.username).toEqual(uname);
    });

    it("should be able to handle many similar userids", async function() {
        const userIdPrefix = "@_longprefix_";
        for (let i = 0; i < 1000; i++) {
            const userId = `${userIdPrefix}${i}:localhost`;
            const config = new IrcClientConfig(userId, 'irc.example.com');
            const result = await identGenerator.getIrcNames(config, serverMock, new MatrixUser(userId));
            if (i === 0) {
                expect(result.username).toBe("longpref");
            }
            else {
                // longpref_1, _2, _3 etc
                expect(result.username).toBe(`${"longprefix".substring(0, 8 - 1 - (i).toString().length)}_${i}`);
            }
        }
    });

    it("should not generate a unique username for IPv6 enabled bridges", async function() {
        const userId = "@-myname:localhost";
        const uname = "M-myname";
        const ipv6Mock = {
            getRealNameFormat: () => "mxid",
            getIpv6Only: () => true,
        }
        // This ensures that we will always return a result for whatever username it picks.
        storeMock.getMatrixUserByUsername = async () => ({
            getId: () => ({userId})
        });
        const info = await identGenerator.getIrcNames(ircClientConfig, ipv6Mock, new MatrixUser(userId));
        expect(info.username).toEqual(uname);
    });
});
