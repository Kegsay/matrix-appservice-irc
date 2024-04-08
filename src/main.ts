import Datastore from "nedb";
import extend from "extend";
import http from "http";
import https from "https";
import { RoomBridgeStore, UserBridgeStore, AppServiceRegistration } from "matrix-appservice-bridge";
import { IrcBridge } from "./bridge/IrcBridge";
import { IrcServer, IrcServerConfig } from "./irc/IrcServer";
import ident from "./irc/Ident";
import * as logging from "./logging";
import { BridgeConfig } from "./config/BridgeConfig";
import * as Sentry from "@sentry/node";
import { getBridgeVersion } from "matrix-appservice-bridge";
import { TestingOptions } from "./config/TestOpts";

const log = logging.get("main");

// We set this to 1000 by default now to set a default, and to ensure we're the first
// one to load the libraries in. Later on in runBridge we actually define the real limit.
http.globalAgent.maxSockets = 1000;
https.globalAgent.maxSockets = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
process.on("unhandledRejection", (reason: any) => {
    let reasonStr = "No reason given";
    if (reason && reason.stack) {
        reasonStr = reason.stack
    }
    else if (typeof(reason) === "string") {
        reasonStr = reason;
    }
    log.error(reasonStr);
});

const _toServer = (domain: string, serverConfig: IrcServerConfig, homeserverDomain: string) => {
    // set server config defaults
    return new IrcServer(
        domain, extend(true, IrcServer.DEFAULT_CONFIG, serverConfig), homeserverDomain
    );
};

export function generateRegistration(reg: AppServiceRegistration, config: BridgeConfig) {
    let asToken;

    if (!reg.getSenderLocalpart()) {
        reg.setSenderLocalpart(IrcBridge.DEFAULT_LOCALPART);
    }
    reg.setId(AppServiceRegistration.generateToken());
    reg.setHomeserverToken(AppServiceRegistration.generateToken());
    reg.setAppServiceToken(asToken || AppServiceRegistration.generateToken());

    // Disable rate limiting to allow large numbers of requests when many IRC users
    // connect, for example on startup.
    reg.setRateLimited(false);

    // Needed to detect activity of users on the bridge.
    reg.pushEphemeral = true;

    // Set protocols to IRC, so that the bridge appears in the list of
    // thirdparty protocols
    reg.setProtocols(["irc"]);

    const serverDomains = Object.keys(config.ircService.servers);
    serverDomains.sort().forEach(function(domain) {
        const server = _toServer(domain, config.ircService.servers[domain], config.homeserver.domain);
        server.getHardCodedRoomIds().sort().forEach(function(roomId) {
            reg.addRegexPattern("rooms", roomId, false);
        });
        // add an alias pattern for servers who want aliases exposed.
        if (server.createsDynamicAliases()) {
            reg.addRegexPattern("aliases", server.getAliasRegex(), true);
        }
        reg.addRegexPattern("users", server.getUserRegex(), true);
    });

    return reg;
}


export async function runBridge(
    port: number,
    config: BridgeConfig,
    reg: AppServiceRegistration,
    testOpts: TestingOptions = { isDBInMemory: false }
) {
    if (config.sentry && config.sentry.enabled && config.sentry.dsn) {
        log.info("Sentry ENABLED");
        Sentry.init({
            dsn: config.sentry.dsn,
            release: getBridgeVersion(),
            environment: config.sentry.environment,
            serverName: config.sentry.serverName,
        });
        const firstNetwork = Object.keys(config.ircService.servers)[0];
        Sentry.getCurrentScope().setTag("irc_network", firstNetwork);
    }
    // configure global stuff for the process
    if (config.ircService.logging) {
        logging.configure(config.ircService.logging);
        logging.setUncaughtExceptionLogger(log);
    }
    if (config.ircService.ident && config.ircService.ident.enabled) {
        ident.configure(config.ircService.ident);
        ident.run();
    }

    const maxSockets = config.advanced?.maxHttpSockets ?? 1000;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("http").globalAgent.maxSockets = maxSockets;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("https").globalAgent.maxSockets = maxSockets;

    // run the bridge
    const ircBridge = new IrcBridge(config, reg, testOpts);
    const engine = config.database ? config.database.engine : "nedb";
    // Use in-memory DBs
    if (testOpts.isDBInMemory) {
        ircBridge.getAppServiceBridge().opts.roomStore = new RoomBridgeStore(new Datastore());
        ircBridge.getAppServiceBridge().opts.userStore = new UserBridgeStore(new Datastore());
    }
    else if (engine === "postgres") {
        // Do nothing
    }
    else if (engine !== "nedb") {
        throw Error("Invalid database configuration");
    }

    await ircBridge.run(port);
    Sentry.captureMessage("Bridge has started", 'info');
    return ircBridge;
}

export async function killBridge(ircBridge: IrcBridge, reason?: string): Promise<void> {
    if (!ircBridge) {
        log.info('killBridge(): No bridge running');
        return;
    }
    const logReason = reason || "(unknown reason)";
    log.info('Killing bridge: ' + logReason);
    await ircBridge.kill(reason);
}
