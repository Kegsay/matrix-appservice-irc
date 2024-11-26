"use strict";
const { IrcServer } = require("../../lib/irc/IrcServer");
const extend = require("extend");
describe("IrcServer", function() {
    describe("getQuitDebounceDelay", () => {
        it("should get a random period between min and max", () => {
            const delayMinMs = 5;
            const delayMaxMs = 10;
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    quitDebounce: {
                        delayMinMs,
                        delayMaxMs,
                    }
                })
            );
            const delay = server.getQuitDebounceDelay();
            expect(delay).toBeGreaterThan(delayMinMs);
            expect(delay).toBeLessThan(delayMaxMs);
        });
    })
    describe("getNick", function() {
        it("should get a nick from a userid", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {})
            );
            expect(server.getNick("@foobar:foobar")).toBe("M-foobar");
        });
        it("should get a nick from a displayname", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {})
            );
            expect(server.getNick("@foobar:foobar", "wiggle")).toBe("M-wiggle");
        });
        it("should get a reduced nick if the displayname contains some invalid chars", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {})
            );
            expect(server.getNick("@foobar:foobar", "💩wiggleケ")).toBe("M-wiggle");
        });
        it("should use localpart if the displayname is all invalid chars", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {})
            );
            expect(server.getNick("@foobar:foobar", "💩ケ")).toBe("M-foobar");
        });
        // These situations shouldn't happen, but we want to avoid rogue homeservers blowing us up.
        it("should get a reduced nick if the localpart contains some invalid chars", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {})
            );
            expect(server.getNick("@💩foobarケ:foobar")).toBe("M-foobar");
        });
        it("should use displayname if the localpart is all invalid chars", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {})
            );
            expect(server.getNick("@💩ケ:foobar", "wiggle")).toBe("M-wiggle");
        });
        it("should throw if no characters could be used, with displayname", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {})
            );
            expect(() => {server.getNick("@💩ケ:foobar", "💩ケ")}).toThrow();
        });
        it("should throw if no characters could be used, with displayname", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {})
            );
            expect(() => {server.getNick("@💩ケ:foobar")}).toThrow();
        });
    })
    describe("getUserLocalpart", function() {
        it("does not touch valid characters", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    matrixClients: {
                        localPartCharacterMapping: 1,
                    }
                })
            );
            expect(server.getUserLocalpart("foobar09.-+")).toEqual("irc.foobar_foobar09.-+");
        });
        it("encodes capital letters", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    matrixClients: {
                        localPartCharacterMapping: 1,
                    }
                })
            );
            expect(server.getUserLocalpart("foOBaR_09.-+")).toEqual("irc.foobar_fo_o_ba_r__09.-+");
        });
        it("encodes invalid characters", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    matrixClients: {
                        localPartCharacterMapping: 1,
                    }
                })
            );
            expect(server.getUserLocalpart("foobar=[m]")).toEqual("irc.foobar_foobar=3d=5bm=5d");
        });
        it("encodes both capital letters and invalid chars", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    matrixClients: {
                        localPartCharacterMapping: 1,
                    }
                })
            );
            expect(server.getUserLocalpart("f_oObAr=[m]")).toEqual("irc.foobar_f__o_ob_ar=3d=5bm=5d");
        });
    });
    describe("getNickFromUserId", function() {
        it("does not touch valid characters", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    matrixClients: {
                        localPartCharacterMapping: 1,
                    }
                })
            );
            expect(server.getNickFromUserId("irc.foobar_foobar09.-+")).toEqual("foobar09.-+");
        });
        it("encodes capital letters", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    matrixClients: {
                        localPartCharacterMapping: 1,
                    }
                })
            );
            expect(server.getNickFromUserId("irc.foobar_fo_o_ba_r__09.-+")).toEqual("foOBaR_09.-+");
        });
        it("decodes invalid characters", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    matrixClients: {
                        localPartCharacterMapping: 1,
                    }
                })
            );
            expect(server.getNickFromUserId("irc.foobar_foobar=3d=5bm=5d")).toEqual("foobar=[m]");
        });
        it("encodes both capital letters and invalid chars", function() {
            const server = new IrcServer("irc.foobar",
                extend(true, IrcServer.DEFAULT_CONFIG, {
                    matrixClients: {
                        localPartCharacterMapping: 1,
                    }
                })
            );
            expect(server.getNickFromUserId("irc.foobar_f__o_ob_ar=3d=5bm=5d")).toEqual("f_oObAr=[m]");
        });
    });
});
