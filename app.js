"use strict";
const Cli = require("matrix-appservice-bridge").Cli;
const log = require("./lib/logging").get("CLI");
const main = require("./lib/main");
const path = require("path");

const REG_PATH = "appservice-registration-irc.yaml";

new Cli({
    registrationPath: REG_PATH,
    enableRegistration: true,
    enableLocalpart: true,
    bridgeConfig: {
        affectsRegistration: true,
        schema: path.join(__dirname, "lib/config/schema.yml"),
        defaults: {
            homeserver: {
                dropMatrixMessagesAfterSecs: 0,
                enablePresence: true
            },
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
        }
    },
    generateRegistration: function(reg, callback) {
        main.generateRegistration(reg, this.getConfig()).done(function(completeRegistration) {
            callback(completeRegistration);
        });
    },
    run: function(port, config, reg) {
        main.runBridge(port, config, reg).catch(function(err) {
            log.error("Failed to run bridge.");
            throw err;
        });
    }
}).run();
