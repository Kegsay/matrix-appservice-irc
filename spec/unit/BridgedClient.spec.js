"use strict";
const { BridgedClient, BridgedClientStatus } = require("../../lib/irc/BridgedClient.js");

const STATE_DISC = {
    status: BridgedClientStatus.DISCONNECTED
}

const STATE_CONN = {
    status: BridgedClientStatus.CONNECTED,
    client: {}
}

const STATE_CONN_MAX5 = {
    status: BridgedClientStatus.CONNECTED,
    client: {
        supported: {
            nicklength: 5
        }
    }
}

describe("BridgedClient", function() {
    describe("getValidNick", function() {
        it("should not change a valid nick", function() {
            const nicks = ["foobar", "foo-bar`", "[foobar]", "{foobar}", "|foobar", "`foobar", "foobar\\", "f1|23_45"];
            for (const nick of nicks) {
                expect(BridgedClient.getValidNick(nick, true, STATE_DISC)).toBe(nick);
            }
        });
        it("should remove invalid characters", function() {
            expect(BridgedClient.getValidNick("f+/\u3052oobar", false, STATE_DISC)).toBe("foobar");
        });
        it("will ensure nicks start with a letter or special character", function() {
            expect(BridgedClient.getValidNick("-foobar", false, STATE_DISC)).toBe("`-foobar");
            expect(BridgedClient.getValidNick("12345", false, STATE_DISC)).toBe("`12345");
        });
        it("will throw if the nick is invalid", function() {
            expect(() => BridgedClient.getValidNick("f+/\u3052oobar", true, STATE_DISC)).toThrowError();
            expect(() => BridgedClient.getValidNick("a".repeat(20), true, STATE_CONN)).toThrowError();
            expect(() => BridgedClient.getValidNick("-foobar", true, STATE_CONN)).toThrowError();
        });
        it("will not truncate a nick if disconnected", function() {
            expect(BridgedClient.getValidNick("a".repeat(20), false, STATE_DISC)).toBe("a".repeat(20));
        });
        it("will truncate nick", function() {
            expect(BridgedClient.getValidNick("a".repeat(20), false, STATE_CONN)).toBe("a".repeat(9));
        });
        it("will truncate a nick with a custom max character limit", function() {
            expect(BridgedClient.getValidNick("a".repeat(20), false, STATE_CONN_MAX5)).toBe("a".repeat(5));
        });
    });
});
