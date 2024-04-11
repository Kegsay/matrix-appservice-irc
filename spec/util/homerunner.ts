import { MatrixClient } from "matrix-bot-sdk";
import { createHash, createHmac } from "crypto";
import { Homerunner } from "homerunner-client";
import { default as crossFetch } from 'cross-fetch';
import { E2ETestMatrixClient } from "./e2e-test";
import { delay } from "../../src/promiseutil";

const HOMERUNNER_IMAGE = process.env.HOMERUNNER_IMAGE || 'complement-synapse';
export const DEFAULT_REGISTRATION_SHARED_SECRET = (
    process.env.REGISTRATION_SHARED_SECRET || 'complement'
);

const homerunner = new Homerunner.Client();

export interface ComplementHomeServer {
    id: string,
    url: string,
    domain: string,
    appserviceConfig: {
        id: string;
        port: number;
        asToken: string;
        hsToken: string;
        senderLocalpart: string;
    };
    users: {userId: string, accessToken: string, deviceId: string, client: E2ETestMatrixClient}[]
}

// Ensure we don't clash with other tests.

async function waitForHomerunner() {

    // Check if port is in use.

    // Needs https://github.com/matrix-org/complement/issues/398
    let attempts = 0;
    do {
        attempts++;
        // Not ready yet.
        console.log(`Waiting for homerunner to be ready (${attempts}/100)`);
        try {
            await homerunner.health();
            break;
        }
        catch (ex) {
            await new Promise(r => setTimeout(r, 1000));
        }
    } while (attempts < 100)
    if (attempts === 100) {
        throw Error('Homerunner was not ready after 100 attempts');
    }
}

export async function createHS(localparts: string[] = [], workerId: number): Promise<ComplementHomeServer> {
    const appPort = 49152 + workerId;
    await waitForHomerunner();
    // Ensure we never use the same port twice.
    const AppserviceConfig = {
        id: 'ircbridge',
        port: appPort,
        hsToken: 'hs_token',
        asToken: 'as_token',
        senderLocalpart: 'ircbridge_bot'
    };
    const blueprint = `${AppserviceConfig.id}_integration_test_${Date.now()}`;
    const asRegistration = {
        ID: AppserviceConfig.id,
        HSToken: AppserviceConfig.hsToken,
        ASToken: AppserviceConfig.asToken,
        SenderLocalpart: AppserviceConfig.senderLocalpart,
        RateLimited: false,
    };
    let blueprintResponse: Awaited<ReturnType<Homerunner.Client["create"]>>|undefined;
    let retries = 0;
    do {
        try {
            blueprintResponse = await homerunner.create({
                base_image_uri: HOMERUNNER_IMAGE,
                blueprint: {
                    Name: blueprint,
                    Homeservers: [{
                        Name: AppserviceConfig.id,
                        ApplicationServices: [{
                            ...asRegistration,
                            URL: `http://host.docker.internal:${AppserviceConfig.port}`,
                        }],
                        Users: localparts.map(localpart => ({Localpart: localpart, DisplayName: localpart})),
                    }],
                }
            });
        }
        catch (ex) {
            console.warn("Failed to create deployment", ex);
            retries++;
            if (retries >= 5) {
                throw ex;
            }
            await delay(1000);
        }
    } while (!blueprintResponse)
    const [homeserverName, homeserver] = Object.entries(blueprintResponse.homeservers)[0];
    const users = Object.entries(homeserver.AccessTokens).map(([userId, accessToken]) => ({
        userId: userId,
        accessToken,
        deviceId: homeserver.DeviceIDs[userId],
        client: new E2ETestMatrixClient(homeserver.BaseURL, accessToken),
    })).filter(u => u.userId !== `@${AppserviceConfig.senderLocalpart}:${homeserverName}`);

    // Start syncing proactively.
    await Promise.all(users.map(u => u.client.start()));
    return {
        users,
        id: blueprint,
        url: homeserver.BaseURL,
        domain: homeserverName,
        appserviceConfig: AppserviceConfig
    };
}

export function destroyHS(
    id: string
): Promise<void> {
    return homerunner.destroy(id);
}

export async function registerUser(
    homeserverUrl: string,
    user: { username: string, admin: boolean },
    sharedSecret = DEFAULT_REGISTRATION_SHARED_SECRET,
): Promise<{mxid: string, client: MatrixClient}> {
    const registerUrl: string = (() => {
        const url = new URL(homeserverUrl);
        url.pathname = '/_synapse/admin/v1/register';
        return url.toString();
    })();

    const nonce = await crossFetch(registerUrl).then(res => res.json()).then(res => res.nonce);
    const password = createHash('sha256')
        .update(user.username)
        .update(sharedSecret)
        .digest('hex');
    const hmac = createHmac('sha1', sharedSecret)
        .update(nonce).update("\x00")
        .update(user.username).update("\x00")
        .update(password).update("\x00")
        .update(user.admin ? 'admin' : 'notadmin')
        .digest('hex');
    return await crossFetch(registerUrl, { method: "POST", body: JSON.stringify(
        {
            nonce,
            username: user.username,
            password,
            admin: user.admin,
            mac: hmac,
        }
    )}).then(res => res.json()).then(res => ({
        mxid: res.user_id,
        client: new MatrixClient(homeserverUrl, res.access_token),
    })).catch(err => { console.log(err.response.body); throw new Error(`Failed to register user: ${err}`); });
}
