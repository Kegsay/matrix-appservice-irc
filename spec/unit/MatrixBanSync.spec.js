const { MatrixGlob } = require("matrix-bot-sdk");
const { MatrixBanSync } = require("../../lib/bridge/MatrixBanSync");

const BANNED_USER_STATE_EVENT = {
    type: "m.policy.rule.user",
    state_key: 'banned-user',
    content: {
        recommendation: 'm.ban',
        entity: '@user:banned.com',
        reason: 'badly-behaved',
    }
};

const BANNED_USER_ENTITY = {
    matcher: new MatrixGlob(BANNED_USER_STATE_EVENT.content.entity),
    entityType: BANNED_USER_STATE_EVENT.type,
    reason: BANNED_USER_STATE_EVENT.content.reason
};

const BANNED_SERVER_STATE_EVENT = {
    type: "m.policy.rule.server",
    state_key: 'banned-server',
    content: {
        recommendation: 'm.ban',
        entity: 'banned-server.com',
        reason: 'badly-constructed',
    }
};

const BANNED_SERVER_ENTITY = {
    matcher: new MatrixGlob(BANNED_SERVER_STATE_EVENT.content.entity),
    entityType: BANNED_SERVER_STATE_EVENT.type,
    reason: BANNED_SERVER_STATE_EVENT.content.reason
};

describe("MatrixBanSync", () => {
    let banSync;
    const intent = {
        join: async (roomOrAlias) => {
            if (roomOrAlias.includes('valid:room')) {
                return roomOrAlias.replace('#', '!');
            }
            throw Error('Room not known');
        },
        roomState: async (roomId) => {
            if (roomId === '!valid:room') {
                return [
                    {
                        type: 'm.policy.rule.server',
                        state_key: 'should-not-be-here',
                        content: {
                            recommendation: 'still-not-interested',
                            entity: 'foo.com',
                            reason: 'foo',
                        }
                    },
                    BANNED_SERVER_STATE_EVENT,
                ];
            }
            else if (roomId === '!anothervalid:room') {
                return [
                    {type: 'not-interested'},
                    BANNED_USER_STATE_EVENT,
                ];
            }
            throw Error('Unknown room');
        },
    };
    beforeEach(() => {
        banSync = new MatrixBanSync(intent, { rooms: [] });
        banSync.interestingRooms = new Set(["!valid:room"]);
    })
    describe("isUserBanned", () => {
        it("should return false for a empty ban set", () => {
            expect(banSync.isUserBanned('@foo:bar')).toBeFalse();
        });
        it("should return false for a empty ban set", () => {
            banSync.bannedEntites.set('foo', BANNED_SERVER_ENTITY);
            banSync.bannedEntites.set('bar', BANNED_USER_ENTITY);
            expect(banSync.isUserBanned('@foo:bar')).toBeFalse();
        });
        it("should return a reason for a matching user ban", () => {
            banSync.bannedEntites.set('foo', BANNED_USER_ENTITY);
            expect(banSync.isUserBanned('@user:banned.com')).toEqual(BANNED_USER_ENTITY.reason);
        });
        it("should return a reason for a matching server ban", () => {
            banSync.bannedEntites.set('foo', BANNED_SERVER_ENTITY);
            expect(banSync.isUserBanned('@user:banned-server.com')).toEqual(BANNED_SERVER_ENTITY.reason);
        });
    });
    describe("handleIncomingState", () => {
        it("should skip unknown type", () => {
            const ev = {...BANNED_USER_STATE_EVENT, type: 'not-a-real-type'};
            expect(banSync.handleIncomingState(ev, '!valid:room')).toBeFalse();
            expect(banSync.bannedEntites.get(`!valid:room:banned-user`)).toBeUndefined();
        });
        it("should skip unknown recommendation", () => {
            const ev = {...BANNED_USER_STATE_EVENT, content: {
                ...BANNED_USER_STATE_EVENT.content,
                recommendation: 'm.tea-party',
            }};
            expect(banSync.handleIncomingState(ev, '!valid:room')).toBeFalse();
            expect(banSync.bannedEntites.get(`!valid:room:banned-user`)).toBeUndefined();
        });
        it("should return true for new user ban event", () => {
            expect(banSync.handleIncomingState(BANNED_USER_STATE_EVENT, '!valid:room')).toBeTrue();
            expect(
                banSync.bannedEntites.get(`!valid:room:banned-user`)
            ).toEqual(BANNED_USER_ENTITY);
        });
        it("should return true for new user ban event", () => {
            expect(banSync.handleIncomingState(BANNED_USER_STATE_EVENT, '!valid:room')).toBeTrue();
            expect(
                banSync.bannedEntites.get(`!valid:room:banned-user`)
            ).toEqual(BANNED_USER_ENTITY);
        });
        it("should return true for new server ban event", () => {
            expect(banSync.handleIncomingState(BANNED_SERVER_STATE_EVENT, '!valid:room')).toBeTrue();
            expect(
                banSync.bannedEntites.get(`!valid:room:banned-server`)
            ).toEqual(BANNED_SERVER_ENTITY);
        });
        it("should delete old rules", () => {
            expect(banSync.handleIncomingState(BANNED_SERVER_STATE_EVENT, '!valid:room')).toBeTrue();
            expect(
                banSync.bannedEntites.get(`!valid:room:banned-server`)
            ).toEqual(BANNED_SERVER_ENTITY);
            expect(banSync.handleIncomingState({
                ...BANNED_SERVER_STATE_EVENT,
                content: {},
            }, '!valid:room')).toBeFalse();
            expect(
                banSync.bannedEntites.get(`!valid:room:banned-server`)
            ).toBeUndefined();
        });
    });
    describe("syncRules", () => {
        it("should sync state from a set of rooms", async () => {
            banSync.config.rooms = ["!valid:room", "#anothervalid:room", "!notvalid:room"];
            await banSync.syncRules();
            expect(banSync.bannedEntites.size).toEqual(2);
            expect(
                banSync.bannedEntites.get(`!valid:room:banned-server`)
            ).toEqual(BANNED_SERVER_ENTITY);
            expect(
                banSync.bannedEntites.get(`!anothervalid:room:banned-user`)
            ).toEqual(BANNED_USER_ENTITY);
        });
    });
});
