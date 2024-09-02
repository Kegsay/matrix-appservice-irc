import { TestIrcServer } from "matrix-org-irc";
import { IrcBridgeE2ETest } from "../util/e2e-test";
import { describe, expect, it } from "@jest/globals";


describe('Reply handling', () => {
    let testEnv: IrcBridgeE2ETest;
    async function setupTestEnv(shortReplyTresholdSeconds: number) {
        testEnv = await IrcBridgeE2ETest.createTestEnv({
            matrixLocalparts: [TestIrcServer.generateUniqueNick("alice"), TestIrcServer.generateUniqueNick("charlie")],
            ircNicks: ['bob'],
            traceToFile: true,
            shortReplyTresholdSeconds,
        });
        await testEnv.setUp();
    }
    afterEach(() => {
        return testEnv?.tearDown();
    });

    it('should use short and long reply formats, depending on elapsed time', async () => {
        await setupTestEnv(1);

        const channel = `#${TestIrcServer.generateUniqueNick("test")}`;
        const { homeserver } = testEnv;
        const [alice, charlie] = homeserver.users.map(u => u.client);
        const { bob } = testEnv.ircTest.clients;

        await bob.join(channel);

        const adminRoomId = await testEnv.createAdminRoomHelper(alice);
        const cRoomId = await testEnv.joinChannelHelper(alice, adminRoomId, channel);
        await charlie.joinRoom(cRoomId);

        const bobUserId = `@irc_${bob.nick}:${homeserver.domain}`;
        await alice.waitForRoomEvent(
            {eventType: 'm.room.member', sender: bobUserId, stateKey: bobUserId, roomId: cRoomId}
        );

        // first message is always a bit delayed, so let's send&await it ahead of time before we get to testing
        let bridgedMessage = bob.waitForEvent('message', 10000);
        await alice.sendText(cRoomId, "warming up...");
        await bridgedMessage;

        const originalMessageBody = "Original message";
        bridgedMessage = bob.waitForEvent('message', 10000);
        const originalMessageId = await alice.sendText(cRoomId, originalMessageBody);
        await bridgedMessage;

        bridgedMessage = bob.waitForEvent('message', 10000);
        await charlie.replyText(cRoomId, {
            event_id: originalMessageId,
        }, "Short reply");
        let ircMessage = await bridgedMessage;

        expect(ircMessage[2]).toContain("Short reply");
        expect(ircMessage[2]).not.toContain("Original message");

        // Delay for the duration it takes to get a long reply.
        await new Promise(r => setTimeout(r, 1000));

        bridgedMessage = bob.waitForEvent('message', 10000);
        await charlie.replyText(cRoomId, {
            event_id: originalMessageId,
        }, "Long reply");
        ircMessage = await bridgedMessage;

        expect(ircMessage[2]).toContain("Long reply");
        expect(ircMessage[2]).toContain("Original message");
    });
    it('should not leak the contents of messages to new joiners', async () => {
        await setupTestEnv(0);

        const channel = `#${TestIrcServer.generateUniqueNick("test")}`;
        const { homeserver, ircBridge } = testEnv;
        const [alice, charlie] = homeserver.users.map(u => u.client);
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
        const aliceMsgBody = "Hello bib!";
        const aliceEventId = alice.sendText(cRoomId, aliceMsgBody);
        await aliceMsg;
        bob.say(channel, "Hi alice!");
        await bobMsg;

        // Now charlie joins and tries to reply to alice.
        await charlie.joinRoom(cRoomId);
        const charlieMsgIrcPromise = bob.waitForEvent('message', 10000);
        await charlie.replyText(cRoomId, {
            event_id: await aliceEventId,
        }, "Sneaky reply to a message I have not seen");

        // Safety check to ensure that we're using the long form reply format.
        expect(ircBridge.config.ircService.matrixHandler?.shortReplyTresholdSeconds).toBe(0);
        // The long form reply format should not contain alice's message.
        const charlieIrcMessage = (await charlieMsgIrcPromise)[2];
        expect(charlieIrcMessage).not.toContain(aliceMsgBody);

        // Now check that alice can reply, as they have been in the room long enough.
        const aliceReplyMsgPromise = bob.waitForEvent('message', 10000);
        await alice.replyText(cRoomId, {
            event_id: await aliceEventId,
        }, "Oh sorry, I meant bob!");
        expect((await aliceReplyMsgPromise)[2]).toContain(aliceMsgBody);

        // restart the bridge, effectively marking members as "been here forever"
        await testEnv.recreateBridge();
        await testEnv.setUp();
        const postRestartAliceMsg = bob.waitForEvent('message', 10000);
        const postRestartAliceMsgBody = "Hello post-restart world!";
        const postRestartAliceEventId = alice.sendText(cRoomId, postRestartAliceMsgBody);
        await postRestartAliceMsg;

        const postRestartCharlieMsg = bob.waitForEvent('message', 10000);
        await charlie.replyText(cRoomId, {
            event_id: await postRestartAliceEventId,
        }, "Hello alice!");
        const postRestartCharlieMsgBody = (await postRestartCharlieMsg)[2];
        expect(postRestartCharlieMsgBody).toContain(postRestartAliceMsgBody);
    });

    it('should not leak the contents of messages to leavers', async () => {
        await setupTestEnv(0);

        const channel = `#${TestIrcServer.generateUniqueNick("test")}`;
        const { homeserver, ircBridge } = testEnv;
        const [alice, charlie] = homeserver.users.map(u => u.client);
        const { bob } = testEnv.ircTest.clients;

        // Create the channel
        await bob.join(channel);

        const adminRoomId = await testEnv.createAdminRoomHelper(alice);
        const cRoomId = await testEnv.joinChannelHelper(alice, adminRoomId, channel);
        const roomName = await alice.getRoomStateEvent(cRoomId, 'm.room.name', '');
        expect(roomName.name).toEqual(channel);

        const bobUserId = `@irc_${bob.nick}:${homeserver.domain}`;
        await alice.waitForRoomEvent(
            {eventType: 'm.room.member', sender: bobUserId, stateKey: bobUserId, roomId: cRoomId}
        );

        await charlie.joinRoom(cRoomId);
        await charlie.leaveRoom(cRoomId);

        // Send some messages
        const aliceMsg = bob.waitForEvent('message', 10000);
        const bobMsg = alice.waitForRoomEvent(
            {eventType: 'm.room.message', sender: bobUserId, roomId: cRoomId}
        );
        const aliceMsgBody = "Hello bib!";
        const aliceEventId = alice.sendText(cRoomId, aliceMsgBody);
        await aliceMsg;
        bob.say(channel, "Hi alice!");
        await bobMsg;

        // Now charlie joins and tries to reply to alice.
        await charlie.joinRoom(cRoomId);
        const charlieMsgIrcPromise = bob.waitForEvent('message', 10000);
        await charlie.replyText(cRoomId, {
            event_id: await aliceEventId,
        }, "Sneaky reply to a message I have not seen");

        // Safety check to ensure that we're using the long form reply format.
        expect(ircBridge.config.ircService.matrixHandler?.shortReplyTresholdSeconds).toBe(0);
        // The long form reply format should not contain alice's message.
        const charlieIrcMessage = (await charlieMsgIrcPromise)[2];
        expect(charlieIrcMessage).not.toContain(aliceMsgBody);
    });
});
