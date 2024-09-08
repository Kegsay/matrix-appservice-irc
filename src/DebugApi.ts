/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import querystring, { ParsedUrlQuery } from "querystring";
import http, { IncomingMessage, ServerResponse } from "http";
import { IrcServer } from "./irc/IrcServer";

import { BridgeRequest } from "./models/BridgeRequest";
import { inspect } from "util";
import { DataStore } from "./datastore/DataStore";
import { ClientPool } from "./irc/ClientPool";
import { getLogger } from "./logging";
import { delay } from "./promiseutil";
import { BridgedClient, BridgedClientStatus } from "./irc/BridgedClient";
import { IrcBridge } from "./bridge/IrcBridge";
import { getBridgeVersion } from "matrix-appservice-bridge";
import { Provisioner } from "./provisioning/Provisioner";

const log = getLogger("DebugApi");

export class DebugApi {
    constructor(
        private ircBridge: IrcBridge,
        private port: number,
        private host: string,
        private servers: IrcServer[],
        private pool: ClientPool,
        private token: string) {

    }

    public run () {
        log.info("DEBUG API LISTENING ON :%d", this.port);

        http.createServer((req, res) => {
            try {
                this.onRequest(req, res);
            }
            catch (err) {
                if (!res.finished) {
                    res.end();
                }
                log.error(err.stack);
            }
        }).listen(this.port, this.host);
    }

    private onRequest(req: IncomingMessage, response: ServerResponse) {
        if (!req.url) {
            response.writeHead(500, { "Content-Type": "text/plain" });
            response.write("Your request reached our server without a URL.");
            response.end();
            throw Error('URL is required but was falsy.');
        }
        const reqPath = req.url.split("?");
        const path = reqPath[0];
        const query = querystring.parse(reqPath[1]);
        log.debug(req.method + " " + path);

        if (query["access_token"] !== this.token) {
            response.writeHead(403, {"Content-Type": "text/plain"});
            response.write("Invalid or missing ?access_token=. " +
                "The app service token is required from the registration.\n");
            response.end();
            log.warn("Failed attempt with token " + query["access_token"]);
            return;
        }

        if (path === "/killUser") {
            this.onKillUser(req, response);
            return;
        }
        else if (req.method === "POST" && path === "/reapUsers") {
            this.onReapUsers(query, response);
            return;
        }
        else if (req.method === "POST" && path === "/warnReapUsers") {
            this.onWarnReapUsers(query, response);
            return;
        }
        else if (req.method === "POST" && path === "/killRoom") {
            this.killRoom(req, response);
            return;
        }
        else if (req.method === "GET" && path === "/inspectUsers") {
            this.inspectUsers(query["regex"] as string, response);
            return;
        }
        else if (req.method === "GET" && path === "/version") {
            response.writeHead(200, {"Content-Type": "text/plain"});
            response.write(getBridgeVersion());
            response.end();
            return;
        }

        // Looks like /irc/$domain/user/$user_id
        const segs = path.split("/");
        if (segs.length !== 5 || segs[1] !== "irc" || segs[3] !== "user") {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("Not a valid debug path.\n");
            response.end();
            return;
        }

        const domain = segs[2];
        const user = segs[4];

        log.debug("Domain: %s User: %s", domain, user);

        const server = this.servers.find((s) => s.domain === domain);

        if (server === undefined) {
            response.writeHead(400, {"Content-Type": "text/plain"});
            response.write("Not a valid domain.\n");
            response.end();
            return;
        }

        let body = "";
        req.on("data", function(chunk) {
            body += chunk;
        });

        req.on("end", () => {
            // Create a promise which resolves to a response string
            let promise: Promise<string>;
            if (req.method === "GET") {
                try {
                    let resBody = this.getClientState(server, user);
                    if (!resBody.endsWith("\n")) {
                        resBody += "\n";
                    }
                    promise = Promise.resolve(resBody);
                }
                catch (err) {
                    promise = Promise.reject(err);
                }
            }
            else if (req.method === "POST") {
                promise = this.sendIRCCommand(server, user, body)
            }
            else {
                promise = Promise.reject(new Error("Bad HTTP method"));
            }

            promise.then((r: string) => {
                response.writeHead(200, {"Content-Type": "text/plain"});
                response.write(r);
                response.end();
            }, (err: Error) => {
                log.error(err.stack);
                response.writeHead(500, {"Content-Type": "text/plain"});
                response.write(err + "\n");
                response.end();
            });
        });
    }

    private onKillUser(req: IncomingMessage, response: ServerResponse) {
        let bodyStr = "";
        req.on("data", function(chunk) {
            bodyStr += chunk;
        });
        req.on("end", () => {
            let promise: Promise<string|null>;
            try {
                const body = JSON.parse(bodyStr);
                if (!body.user_id || !body.reason) {
                    promise = Promise.reject(new Error("Need user_id and reason"));
                }
                else {
                    promise = this.killUser(body.user_id, body.reason, body.deactivate);
                }
            }
            catch (err) {
                promise = Promise.reject(err);
            }

            promise.then((r) => {
                response.writeHead(200, {"Content-Type": "text/plain"});
                response.write(r + "\n");
                response.end();
            }, (err: Error) => {
                log.error(err.stack);
                response.writeHead(500, {"Content-Type": "text/plain"});
                response.write(err + "\n");
                response.end();
            });
        });
    }

    public onWarnReapUsers(query: ParsedUrlQuery, response: ServerResponse) {
        const server = query["server"] as string;
        const since = parseInt(query["since"] as string);
        const msg = query["msg"] as string;
        const limit = query["targetCount"] !== undefined ? parseInt(query["targetCount"] as string) : undefined;
        const defaultOnline = (query["defaultOnline"] ?? "true") === "true";
        const excludeRegex = query["excludeRegex"] as string;
        const req = new BridgeRequest(this.ircBridge.getAppServiceBridge().getRequestFactory().newRequest());
        this.ircBridge.warnConnectionReap(
            req, server, since, msg, defaultOnline, excludeRegex, limit,
        ).catch((err: Error) => {
            log.warn(`Failed to handle onWarnReapUsers`, err);
            if (!response.headersSent) {
                response.writeHead(500, {"Content-Type": "text/plain"});
            }
            response.write(err + "\n");
        }).finally(() => {
            response.end();
        });
    }

    public onReapUsers(query: ParsedUrlQuery, response: ServerResponse) {
        const msgCb = (msg: string) => {
            if (!response.headersSent) {
                response.writeHead(200, {"Content-Type": "text/plain"});
            }
            response.write(msg + "\n")
        };
        const server = query["server"] as string;
        const since = parseInt(query["since"] as string);
        const limit = query["targetCount"] !== undefined ? parseInt(query["targetCount"] as string) : undefined;
        const reason = query["reason"] as string;
        const dry = query["dryrun"] !== undefined && query["dryrun"] !== "false";
        const defaultOnline = (query["defaultOnline"] ?? "true") === "true";
        const excludeRegex = query["excludeRegex"] as string;
        this.ircBridge.connectionReap(
            msgCb, server, since, reason, dry, defaultOnline, excludeRegex, limit,
        ).catch((err: Error) => {
            log.warn(`Failed to handle onReapUsers`, err);
            if (!response.headersSent) {
                response.writeHead(500, {"Content-Type": "text/plain"});
            }
            response.write(err + "\n");
        }).finally(() => {
            response.end();
        });
    }

    private getClient(server: IrcServer, user: string) {
        if (!user) {
            return this.pool.getBot(server);
        }
        return this.pool.getBridgedClientByUserId(server, user);
    }

    private getClientState(server: IrcServer, user: string) {
        log.debug("getClientState(%s,%s)", server.domain, user);
        const client = this.getClient(server, user);
        if (!client) {
            return "User " + user + " does not have a client on " + server.domain;
        }
        return inspect(client, { colors:true, depth:7 });
    }

    private async killUser(userId: string, reason: string, deactivate: boolean): Promise<string|null> {
        const req = new BridgeRequest(this.ircBridge.getAppServiceBridge().getRequestFactory().newRequest());
        if (deactivate) {
            await this.ircBridge.getStore().deactivateUser(userId);
        }
        const clients = this.pool.getBridgedClientsForUserId(userId);
        return this.ircBridge.matrixHandler.quitUser(req, userId, clients, null, reason);
    }

    private async sendIRCCommand(server: IrcServer, user: string, body: string): Promise<string> {
        log.debug("sendIRCCommand(%s,%s,%s)", server.domain, user, body);
        const client = this.getClient(server, user);
        if (!client) {
            return "User " + user + " does not have a client on " + server.domain + "\n";
        }
        if (client.status !== BridgedClientStatus.CONNECTED) {
            return "There is no underlying client instance.\n";
        }

        // store all received response strings
        const buffer: string[] = [];
        // "raw" can take many forms
        const listener = (msg: unknown) => {
            buffer.push(JSON.stringify(msg));
        }

        client.addClientListener("raw", listener);
        // turn rn to n so if there are any new lines they are all n.
        body = body.replace("\r\n", "\n");
        body.split("\n").forEach((c: string) => {
            // IRC protocol require rn
            client.writeToConnection(c + "\r\n");
            buffer.push(c);
        });

        // wait 3s to pool responses
        await delay(3000);

        // unhook listener to avoid leaking
        client.removeClientListener("raw", listener);
        return buffer.join("\n") + "\n";
    }

    private async killRoom (req: IncomingMessage, response: ServerResponse) {
        const store = this.ircBridge.getStore() as DataStore;
        const result: { error: string[]; stages: string[] } = {
            error: [], // string|[string] containing a fatal error or minor errors.
            stages: [] // stages completed for removing the room. It's possible it might only
            // half complete, and we should make that obvious.
        };
        const body = (await this.wrapJsonReq(req, response)) as {
            room_id: string;
            domain: string;
            channel: string;
            leave_notice?: boolean;
            remove_alias?: boolean;
        };

        if (typeof(body.room_id) !== "string") {
            result.error.push(`'room_id' is missing from body or not a string`);
        }

        if (typeof(body.domain) !== "string") {
            result.error.push(`'domain' is missing from body or not a string`);
        }

        if (typeof(body.channel) !== "string") {
            result.error.push(`'channel' is missing from body or not a string`);
        }

        // Room room_id to lookup and delete the alias from.
        const roomId = body["room_id"];
        // IRC server domain
        const domain = body["domain"];
        // IRC channel
        const channel = body["channel"];
        // Should we tell the room about the deletion. Defaults to true.
        const notice = !(body["leave_notice"] === false);
        // Should we remove the alias from the room. Defaults to true.
        const removeAlias = !(body["remove_alias"] === false);

        if (result.error.length > 0) {
            this.wrapJsonResponse(result.error, false, response);
            return;
        }

        log.info(`Killing room ${roomId} (${domain} ${channel}) removeAlias: ${removeAlias} notice: ${notice}`);

        // Find room
        const room = await store.getRoom(
            roomId,
            domain,
            channel
        );
        if (room === null) {
            result.error.push("Room not found");
            this.wrapJsonResponse(result, false, response);
            return;
        }

        const server = this.servers.find((srv) => srv.domain === domain);
        if (server === undefined) {
            result.error.push("Server not found!");
            this.wrapJsonResponse(result, false, response);
            return;
        }

        // Drop room from room store.
        await store.removeRoom(
            roomId,
            domain,
            channel
        );
        result.stages.push("Removed room from store");

        if (notice) {
            try {
                await this.ircBridge.getAppServiceBridge().getIntent().sendMessage(roomId,
                    {
                        msgtype: "m.notice",
                        body: `This room has been unbridged from ${channel} (${server.getReadableName()})`
                    });
                result.stages.push("Left notice in room");
            }
            catch (e) {
                result.error.push("Failed to send a leave notice");
            }
        }

        if (removeAlias) {
            const roomAlias = server.getAliasFromChannel(channel);
            try {
                await this.ircBridge.getAppServiceBridge().getIntent().matrixClient.deleteRoomAlias(roomAlias);
                result.stages.push("Deleted alias for room");
            }
            catch (e) {
                result.error.push("Failed to remove alias");
            }
        }

        // Drop clients from room.
        // The provisioner will only drop clients who are not in other rooms.
        // It will also leave the MatrixBot.
        try {
            await this.ircBridge.getProvisioner().leaveIfUnprovisioned(
                Provisioner.createFakeRequest("killRoom", "bridge"),
                roomId,
                server,
                channel
            );
        }
        catch (e) {
            result.error.push("Failed to leave users from room");
            result.error.push(e);
            this.wrapJsonResponse(result, false, response);
            return;
        }

        result.stages.push("Parted clients where applicable.");
        this.wrapJsonResponse(result, true, response);
    }

    private inspectUsers(regex: string, response: ServerResponse) {
        if (!regex) {
            this.wrapJsonResponse({
                "error": "'regex' not provided",
            }, false, response);
            return;
        }
        try {
            const userClients = this.ircBridge.getBridgedClientsForRegex(regex);
            const clientsResponse: {[userId: string]: Array<{
                channels: string[];
                dead: boolean;
                server: string;
                nick: string;
            }|undefined>;} = {};
            Object.keys(userClients).forEach((userId) => {
                clientsResponse[userId] = userClients[userId].map((client: BridgedClient) => {
                    if (!client) {
                        return undefined;
                    }
                    return {
                        channels: [...client.chanList],
                        dead: client.isDead(),
                        server: client.server.domain,
                        nick: client.nick,
                    };
                });
            });
            this.wrapJsonResponse({
                users: clientsResponse,
            }, true, response);
        }
        catch (ex) {
            this.wrapJsonResponse({
                "error": "Failed to fetch clients for user",
                "info": String(ex),
            }, false, response);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private wrapJsonReq(req: IncomingMessage, response: ServerResponse): Promise<unknown> {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        return new Promise((resolve, reject) => {
            req.on("error", (err) => {
                reject(err);
            });
            req.on("end", () => {
                if (body === "") {
                    reject({"error": "Body missing"});
                }
                try {
                    resolve(JSON.parse(body));
                }
                catch (err) {
                    reject(err);
                }
            });
        });
    }

    private wrapJsonResponse(json: unknown, isOk: boolean, response: ServerResponse) {
        response.writeHead(isOk === true ? 200 : 500, {"Content-Type": "application/json"});
        response.write(JSON.stringify(json));
        response.end();
    }
}
