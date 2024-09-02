import { TestIrcServer } from "matrix-org-irc";
import { IrcBridgeE2ETest } from "../util/e2e-test";
import { describe, it } from "@jest/globals";


describe('Ensure quit messsage is sent', () => {
    let testEnv: IrcBridgeE2ETest;
    beforeEach(async () => {
        testEnv = await IrcBridgeE2ETest.createTestEnv({
            matrixLocalparts: [TestIrcServer.generateUniqueNick('alice')],
            ircNicks: ['bob'],
            traceToFile: true,
        });
        await testEnv.setUp();
    });
    afterEach(() => {
        return testEnv?.tearDown();
    });
    it('should correctly send a quit message on !reconnect', async () => {
        const channel = `#${TestIrcServer.generateUniqueNick("test")}`;
        const { homeserver, opts } = testEnv;
        const [alice] = homeserver.users.map(c => c.client);
        const { bob } = testEnv.ircTest.clients;

        // Create the channel
        await bob.join(channel);
        const adminRoom = await testEnv.createAdminRoomHelper(alice)
        const cRoomId = await testEnv.joinChannelHelper(alice, adminRoom, channel);

        // Ensure we join the IRC side
        alice.sendText(cRoomId, `Hello world!`);
        await bob.waitForEvent('message', 10000);

        const quitEvent = bob.waitForEvent('quit', 10000);

        // Now, have alice quit.
        await alice.sendText(adminRoom, `!reconnect`);
        const [nick, message, channels] = await quitEvent;
        expect(nick).toEqual(`M-${opts.matrixLocalparts?.[0]}`);
        expect(message).toEqual('Quit: Reconnecting');
        expect(channels).toContain(channel);
        alice.sendText(cRoomId, `I'm back baby!`);
        await bob.waitForEvent('message', 10000);
    });
});
