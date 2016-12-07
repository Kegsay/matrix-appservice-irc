"use strict";
var Promise = require("bluebird");
var extend = require("extend");
var Datastore = require("nedb");

var AppServiceRegistration = require("matrix-appservice-bridge").AppServiceRegistration;
var RoomBridgeStore = require("matrix-appservice-bridge").RoomBridgeStore;
var UserBridgeStore = require("matrix-appservice-bridge").UserBridgeStore;

var IrcBridge = require("./bridge/IrcBridge.js");
var IrcServer = require("./irc/IrcServer.js");
var stats = require("./config/stats");
var ident = require("./irc/ident");
var logging = require("./logging");
var log = logging.get("main");

process.on("unhandledRejection", function(reason, promise) {
    log.error(reason ? reason.stack : "No reason given");
});

var _toServer = function(domain, serverConfig, homeserverDomain) {
    // set server config defaults
    if (serverConfig.dynamicChannels.visibility) {
        throw new Error(
            `[DEPRECATED] Use of the config field dynamicChannels.visibility
            is deprecated. Use dynamicChannels.published, dynamicChannels.joinRule
            and dynamicChannels.createAlias instead.`
        );
    }
    return new IrcServer(
        domain, extend(true, IrcServer.DEFAULT_CONFIG, serverConfig), homeserverDomain
    );
};

module.exports.defaultConfig = function() {
    return {
        ircService: {
            ident: {
                enabled: false,
                port: 113
            },
            logging: {
                level: "debug",
                toConsole: true
            },
            statsd: {},
            debugApi: {},
            provisioning: {
                enabled: false,
                requestTimeoutSeconds: 60 * 5
            }
        }
    };
};

module.exports.generateRegistration = Promise.coroutine(function*(reg, config) {
    var asToken;
    if (config.appService) {
        console.warn(
            `[DEPRECATED] Use of config field 'appService' is deprecated.
            Remove this field from the config file to remove this warning.

            This release will use values from this config file. This will produce
            a fatal error in a later release.

            The new format looks like:
            homeserver:
                url: "https://home.server.url"
                domain: "home.server.url"

            The new locations for the missing fields are as follows:
            http.port - Passed as a CLI flag --port.
            appservice.token - Automatically generated.
            appservice.url - Passed as a CLI flag --url
            localpart - Passed as a CLI flag --localpart
            `
        );
        if (config.appService.localpart) {
            console.log("NOTICE: Using localpart from config file");
            reg.setSenderLocalpart(config.appService.localpart);
        }
        asToken = config.appService.appservice.token;
    }

    if (!reg.getSenderLocalpart()) {
        reg.setSenderLocalpart(IrcBridge.DEFAULT_LOCALPART);
    }
    reg.setId(AppServiceRegistration.generateToken());
    reg.setHomeserverToken(AppServiceRegistration.generateToken());
    reg.setAppServiceToken(asToken || AppServiceRegistration.generateToken());

    // Disable rate limiting to allow large numbers of requests when many IRC users
    // connect, for example on startup.
    reg.setRateLimited(false);

    let serverDomains = Object.keys(config.ircService.servers);
    serverDomains.sort().forEach(function(domain) {
        let server = _toServer(domain, config.ircService.servers[domain], config.homeserver.domain);
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
});

var ircBridge;
module.exports.runBridge = Promise.coroutine(function*(port, config, reg, isDBInMemory) {
    // configure global stuff for the process
    if (config.ircService.logging) {
        logging.configure(config.ircService.logging);
        logging.setUncaughtExceptionLogger(log);
    }
    if (config.ircService.statsd.hostname) {
        stats.setEndpoint(config.ircService.statsd);
    }
    if (config.ircService.ident.enabled) {
        ident.configure(config.ircService.ident);
        ident.run();
    }

    // backwards compat for 1 release. TODO remove
    if (config.appService && !config.homeserver) {
        config.homeserver = config.appService.homeserver;
    }

    if (ircBridge) {
        log.warn('Bridge already running, destroying reference to existing bridge!');
    }

    // run the bridge
    ircBridge = new IrcBridge(config, reg);

    // Use in-memory DBs
    if (isDBInMemory) {
        ircBridge._bridge.opts.roomStore = new RoomBridgeStore(new Datastore());
        ircBridge._bridge.opts.userStore = new UserBridgeStore(new Datastore());
    }

    yield ircBridge.run(port);
});

module.exports.killBridge = function() {
    if (!ircBridge) {
        log.info('killBridge(): No bridge running');
        return Promise.resolve();
    }
    log.info('Killing bridge');
    return ircBridge.kill();
}
