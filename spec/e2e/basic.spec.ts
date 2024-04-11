import { TestIrcServer } from "matrix-org-irc";
import { IrcBridgeE2ETest } from "../util/e2e-test";
import { describe, expect, it } from "@jest/globals";


describe('Basic bridge usage', () => {
    let testEnv: IrcBridgeE2ETest;
    beforeEach(async () => {
        testEnv = await IrcBridgeE2ETest.createTestEnv({
            matrixLocalparts: [TestIrcServer.generateUniqueNick("alice")],
            ircNicks: ['bob'],
            traceToFile: true,
        });
        await testEnv.setUp();
    });
    afterEach(() => {
        return testEnv?.tearDown();
    });
    it('should be able to dynamically bridge a room via the !join command', async () => {
        const channel = `#${TestIrcServer.generateUniqueNick("test")}`;
        const { homeserver } = testEnv;
        const alice = homeserver.users[0].client;
        const { bob } = testEnv.ircTest.clients;

        // Create the channel
        await bob.join(channel);

        const adminRoomId = await testEnv.createAdminRoomHelper(alice);
        const cRoomId = await testEnv.joinChannelHelper(alice, adminRoomId, channel);
        const roomName = await alice.getRoomStateEvent(cRoomId, 'm.room.name', '');
        expect(roomName.name).toEqual(channel);

        // And finally wait for bob to appear.
        const bobUserId = `@irc_${bob.nick}:${homeserver.domain}`;
        await alice.waitForRoomEvent(
            {eventType: 'm.room.member', sender: bobUserId, stateKey: bobUserId, roomId: cRoomId}
        );

        // Send some messages
        const aliceMsg = bob.waitForEvent('message', 10000);
        const bobMsg = alice.waitForRoomEvent(
            {eventType: 'm.room.message', sender: bobUserId, roomId: cRoomId}
        );
        alice.sendText(cRoomId, "Hello bob!");
        await aliceMsg;
        bob.say(channel, "Hi alice!");
        await bobMsg;
    });
});
