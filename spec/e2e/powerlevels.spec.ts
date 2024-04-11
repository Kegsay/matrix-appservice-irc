/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { TestIrcServer } from "matrix-org-irc";
import { IrcBridgeE2ETest } from "../util/e2e-test";
import { describe, it } from "@jest/globals";


describe('Ensure powerlevels are appropriately applied', () => {
    let testEnv: IrcBridgeE2ETest;
    beforeEach(async () => {
        testEnv = await IrcBridgeE2ETest.createTestEnv({
            matrixLocalparts: ['alice'],
            ircNicks: ['bob', 'charlie'],
            traceToFile: true,
        });
        await testEnv.setUp();
    });
    afterEach(() => {
        return testEnv?.tearDown();
    });
    it('should update powerlevel of IRC user when OPed by an IRC user', async () => {
        const channel = `#${TestIrcServer.generateUniqueNick("test")}`;
        const { homeserver } = testEnv;
        const alice = homeserver.users[0].client;
        const { bob, charlie } = testEnv.ircTest.clients;
        const bobUserId = `@irc_${bob.nick}:${homeserver.domain}`;
        const charlieUserId = `@irc_${charlie.nick}:${homeserver.domain}`;

        // Create the channel
        await bob.join(channel);

        const cRoomId = await testEnv.joinChannelHelper(alice, await testEnv.createAdminRoomHelper(alice), channel);

        // Now have charlie join and be opped.
        const charlieJoinPromise = bob.waitForEvent('join');
        await charlie.join(channel);
        const operatorPL = testEnv.ircBridge.config.ircService.servers.localhost.modePowerMap!.o;
        const plEvent = alice.waitForPowerLevel(
            cRoomId, {
                users: {
                    [bobUserId]: operatorPL,
                    [charlieUserId]: operatorPL,
                    [testEnv.ircBridge.appServiceUserId]: 100,
                },
            },
        );

        await charlieJoinPromise;
        await bob.send('MODE', channel, '+o', charlie.nick);
        expect(await plEvent).toBeDefined();
    });
});
