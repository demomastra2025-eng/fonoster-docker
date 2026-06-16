"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = router;
/*
 * Copyright (C) 2026 by Fonoster Inc (https://fonoster.com)
 * http://github.com/fonoster/routr
 *
 * This file is part of Routr.
 *
 * Licensed under the MIT License (the "License");
 * you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *    https://opensource.org/licenses/MIT
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const types_1 = require("./types");
const common_1 = require("@routr/common");
const utils_1 = require("./utils");
const processor_1 = require("@routr/processor");
const errors_1 = require("./errors");
const logger_1 = require("@fonoster/logger");
const access_1 = require("./access");
const logger = (0, logger_1.getLogger)({ service: "connect", filePath: __filename });
const jwtVerifier = (0, utils_1.getVerifierImpl)();
const isWebSocketRoute = (route) => (route === null || route === void 0 ? void 0 : route.transport) === common_1.CommonTypes.Transport.WS || (route === null || route === void 0 ? void 0 : route.transport) === common_1.CommonTypes.Transport.WSS;
const selectPreferredContactRoute = (routes) => {
    const webSocketRoutes = routes
        .filter(isWebSocketRoute)
        .sort((a, b) => (b.registeredOn || 0) - (a.registeredOn || 0));
    return webSocketRoutes[0] || routes[0];
};
// eslint-disable-next-line require-jsdoc
function router(location, apiClient) {
    return (request) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const fromURI = request.message.from.address.uri;
        const requestURI = request.message.requestUri;
        let caller;
        let callee;
        if ((0, utils_1.hasXConnectObjectHeader)(request)) {
            const connectToken = processor_1.Extensions.getHeaderValue(request, common_1.CommonTypes.ExtraHeader.CONNECT_TOKEN);
            try {
                if (!jwtVerifier) {
                    return common_1.CommonResponse.createServerInternalErrorResponse();
                }
                const payload = (yield jwtVerifier.verify(connectToken));
                const domain = yield (0, utils_1.findDomain)(apiClient, payload.domain);
                if (!payload.allowedMethods.includes(common_1.Method.INVITE)) {
                    return common_1.CommonResponse.createForbiddenResponse();
                }
                const { ref, domainRef } = payload;
                caller = {
                    apiVersion: common_1.CommonConnect.APIVersion.V2,
                    ref,
                    name: (_a = request.message.from.address.displayName) !== null && _a !== void 0 ? _a : common_1.CommonTypes.ANONYMOUS,
                    domain,
                    domainRef,
                    username: common_1.CommonTypes.ANONYMOUS,
                    privacy: processor_1.Extensions.getHeaderValue(request, "Privacy"),
                    enabled: true
                };
                callee = (yield apiClient.peers.findBy({
                    fieldName: "aor",
                    fieldValue: payload.aorLink
                })).items[0];
                // Experimental support for Ephemeral Agents when calling agent-to-agent
                if (!callee) {
                    callee = {
                        apiVersion: common_1.CommonConnect.APIVersion.V2,
                        ref: common_1.CommonTypes.ANONYMOUS,
                        name: common_1.CommonTypes.ANONYMOUS,
                        domain: domain,
                        domainRef: payload.domainRef,
                        username: common_1.CommonTypes.ANONYMOUS,
                        privacy: processor_1.Extensions.getHeaderValue(request, "Privacy"),
                        enabled: true
                    };
                }
            }
            catch (e) {
                logger.verbose("unable to validate connect token", {
                    originalError: e.message
                });
                return common_1.CommonResponse.createForbiddenResponse();
            }
        }
        else {
            caller = yield (0, utils_1.findResource)(apiClient, fromURI.host, fromURI.user);
            callee = yield (0, utils_1.findResource)(apiClient, requestURI.host, requestURI.user);
        }
        const routingDirection = (0, utils_1.getRoutingDirection)(caller, callee);
        logger.verbose("routing request from: " +
            (0, utils_1.getSipUri)(fromURI) +
            ", to: " +
            (0, utils_1.getSipUri)(requestURI), {
            fromURI: (0, utils_1.getSipUri)(fromURI),
            requestURI: (0, utils_1.getSipUri)(requestURI),
            routingDirection
        });
        if (!(0, utils_1.hasXConnectObjectHeader)(request) &&
            request.method === common_1.CommonTypes.Method.INVITE) {
            const failedCheck = yield (0, access_1.checkAccess)({
                apiClient,
                request,
                caller,
                callee,
                routingDirection
            });
            if (failedCheck) {
                return failedCheck;
            }
        }
        const result = (direction, route, extended) => route
            ? {
                direction,
                route: Object.assign(Object.assign({}, route), { metadata: extended })
            }
            : {
                direction,
                route: null
            };
        // We add metadata to the route object so we can use it later to link to an account
        switch (routingDirection) {
            case types_1.RoutingDirection.AGENT_TO_AGENT: {
                const route = yield agentToAgent(location, request);
                return result(routingDirection, route, caller.extended);
            }
            case types_1.RoutingDirection.PEER_TO_AGENT: {
                const route = yield agentToAgent(location, request);
                return result(routingDirection, route, callee === null || callee === void 0 ? void 0 : callee.extended);
            }
            case types_1.RoutingDirection.AGENT_TO_PEER: {
                const route = yield agentToPeer(location, callee, request);
                return result(routingDirection, route, caller.extended);
            }
            case types_1.RoutingDirection.AGENT_TO_PSTN: {
                const route = yield agentToPSTN(request, caller, requestURI.user);
                return result(routingDirection, route, caller.extended);
            }
            case types_1.RoutingDirection.FROM_PSTN: {
                const route = yield fromPSTN(apiClient, location, callee, request);
                return result(routingDirection, route, callee.extended);
            }
            case types_1.RoutingDirection.PEER_TO_PSTN:
                return result(routingDirection, yield peerToPSTN(apiClient, request), callee === null || callee === void 0 ? void 0 : callee.extended);
            default:
                throw new errors_1.UnsupportedRoutingError(routingDirection);
        }
    });
}
// eslint-disable-next-line require-jsdoc
function agentToAgent(location, req) {
    return __awaiter(this, void 0, void 0, function* () {
        return selectPreferredContactRoute(yield location.findRoutes({ aor: processor_1.Target.getTargetAOR(req), callId: req.ref }));
    });
}
/**
 * From PSTN routing.
 *
 * @param {APIClient} apiClient - API client
 * @param {ILocationService} location - Location service
 * @param {Resource} callee - The callee
 * @param {MessageRequest} req - The request
 * @return {Promise<Route>}
 */
function fromPSTN(apiClient, location, callee, req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const sessionAffinityRef = processor_1.Extensions.getHeaderValue(req, callee.sessionAffinityHeader);
        let backend;
        const peer = (yield apiClient.peers.findBy({
            fieldName: "aor",
            fieldValue: callee.aorLink
        })).items[0];
        if (peer) {
            backend = {
                balancingAlgorithm: peer.balancingAlgorithm,
                withSessionAffinity: peer.withSessionAffinity
            };
        }
        const route = selectPreferredContactRoute(yield location.findRoutes({
            aor: callee.aorLink,
            callId: req.ref,
            sessionAffinityRef,
            backend
        }));
        if (!route) {
            return null;
        }
        if (!route.headers)
            route.headers = [];
        (_a = callee.extraHeaders) === null || _a === void 0 ? void 0 : _a.forEach((prop) => {
            const p = {
                name: prop.name,
                value: prop.value,
                action: common_1.CommonTypes.HeaderModifierAction.ADD
            };
            route.headers.push(p);
        });
        return route;
    });
}
// eslint-disable-next-line require-jsdoc
function agentToPSTN(req, agent, calleeNumber) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        if (!((_a = agent.domain) === null || _a === void 0 ? void 0 : _a.egressPolicies)) {
            // TODO: Create custom error
            throw new Error(`no egress policy found for Domain ref: ${agent.domain.ref}`);
        }
        // Look for Number in domain that matches regex callee
        const policy = agent.domain.egressPolicies.find((policy) => {
            const regex = new RegExp(policy.rule);
            return regex.test(calleeNumber);
        });
        if (!policy) {
            throw new Error(`no egress policy matching number "${calleeNumber}" in Domain ref: ${agent.domain.ref}`);
        }
        const trunk = (_b = policy.number) === null || _b === void 0 ? void 0 : _b.trunk;
        if (!trunk) {
            // This should never happen
            throw new Error(`no trunk associated with Number ref: ${(_c = policy.number) === null || _c === void 0 ? void 0 : _c.ref}`);
        }
        const via = req.message.via[0];
        const uri = (0, utils_1.getTrunkURI)(trunk);
        return {
            user: uri.user,
            host: uri.host,
            port: uri.port,
            advertisedHost: via.host,
            advertisedPort: via.port,
            transport: (_d = uri.transport) === null || _d === void 0 ? void 0 : _d.toUpperCase(),
            edgePortRef: req.edgePortRef,
            listeningPoints: req.listeningPoints,
            localnets: req.localnets,
            externalAddrs: req.externalAddrs,
            headers: [
                // TODO: Find a more deterministic way to re-add the Privacy header
                {
                    name: "Privacy",
                    action: common_1.CommonTypes.HeaderModifierAction.REMOVE
                },
                {
                    name: "Privacy",
                    value: ((_e = agent.privacy) === null || _e === void 0 ? void 0 : _e.toUpperCase()) === common_1.CommonTypes.Privacy.PRIVATE
                        ? common_1.CommonTypes.Privacy.PRIVATE.toLowerCase()
                        : common_1.CommonTypes.Privacy.NONE.toLowerCase(),
                    action: common_1.CommonTypes.HeaderModifierAction.ADD
                },
                (0, utils_1.createRemotePartyId)(trunk, policy.number),
                (0, utils_1.createPAssertedIdentity)(req, trunk, policy.number),
                yield (0, utils_1.createTrunkAuthentication)(trunk)
            ]
        };
    });
}
// eslint-disable-next-line require-jsdoc
function agentToPeer(location, callee, req) {
    return __awaiter(this, void 0, void 0, function* () {
        const backend = {
            balancingAlgorithm: callee.balancingAlgorithm,
            withSessionAffinity: callee.withSessionAffinity
        };
        return (yield location.findRoutes({
            aor: callee.aor,
            callId: req.ref,
            backend
        }))[0];
    });
}
// eslint-disable-next-line require-jsdoc
function peerToPSTN(apiClient, req) {
    return __awaiter(this, void 0, void 0, function* () {
        const numberTel = processor_1.Extensions.getHeaderValue(req, common_1.CommonTypes.ExtraHeader.DOD_NUMBER);
        const privacy = processor_1.Extensions.getHeaderValue(req, common_1.CommonTypes.ExtraHeader.DOD_PRIVACY);
        const number = yield (0, utils_1.findNumberByTelUrl)(apiClient, `tel:${numberTel}`);
        if (!number) {
            throw new Error(`no Number found for tel: ${numberTel}`);
        }
        if (!number.trunk) {
            // TODO: Create custom error
            throw new Error(`no trunk associated with Number ref: ${number.ref}`);
        }
        const via = req.message.via[0];
        const uri = (0, utils_1.getTrunkURI)(number.trunk);
        return {
            user: uri.user,
            host: uri.host,
            port: uri.port,
            advertisedHost: via.host,
            advertisedPort: via.port,
            transport: uri.transport,
            edgePortRef: req.edgePortRef,
            listeningPoints: req.listeningPoints,
            localnets: req.localnets,
            externalAddrs: req.externalAddrs,
            headers: [
                // TODO: Find a more deterministic way to re-add the Privacy header
                {
                    name: "Privacy",
                    action: common_1.CommonTypes.HeaderModifierAction.REMOVE
                },
                {
                    name: "Privacy",
                    value: (privacy === null || privacy === void 0 ? void 0 : privacy.toLocaleLowerCase()) === common_1.CommonTypes.Privacy.PRIVATE
                        ? common_1.CommonTypes.Privacy.PRIVATE.toLowerCase()
                        : common_1.CommonTypes.Privacy.NONE.toLowerCase(),
                    action: common_1.CommonTypes.HeaderModifierAction.ADD
                },
                (0, utils_1.createRemotePartyId)(number.trunk, number),
                (0, utils_1.createPAssertedIdentity)(req, number.trunk, number),
                yield (0, utils_1.createTrunkAuthentication)(number.trunk)
            ]
        };
    });
}
