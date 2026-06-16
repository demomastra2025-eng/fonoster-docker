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
/* eslint-disable require-jsdoc */
const errors_1 = require("./errors");
const common_1 = require("@routr/common");
const utils_1 = require("./utils");
var AOR_SCHEME;
(function (AOR_SCHEME) {
    AOR_SCHEME["SIP"] = "sip:";
    AOR_SCHEME["BACKEND"] = "backend:";
})(AOR_SCHEME || (AOR_SCHEME = {}));
const isWebSocketRoute = (route) => (route === null || route === void 0 ? void 0 : route.transport) === common_1.CommonTypes.Transport.WS || (route === null || route === void 0 ? void 0 : route.transport) === common_1.CommonTypes.Transport.WSS;
const isSameContact = (left, right) => left.user === right.user &&
    left.host === right.host &&
    left.port === right.port &&
    left.transport === right.transport;
const getWebSocketReplacementCandidate = (existingRoutes, incoming, maxContacts, routeAlreadyExists) => {
    if (routeAlreadyExists ||
        maxContacts === -1 ||
        existingRoutes.length < maxContacts ||
        !isWebSocketRoute(incoming)) {
        return null;
    }
    return existingRoutes
        .filter((route) => isWebSocketRoute(route) &&
        route.user === incoming.user &&
        !isSameContact(route, incoming))
        .sort((left, right) => { var _a, _b; return ((_a = left.registeredOn) !== null && _a !== void 0 ? _a : 0) - ((_b = right.registeredOn) !== null && _b !== void 0 ? _b : 0); })[0];
};
const deleteRouteContact = (store, aor, routeToDelete) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof store.deleteRoute === "function") {
        return store.deleteRoute(aor, routeToDelete);
    }
    const existingRoutes = yield store.get(aor);
    const remainingRoutes = existingRoutes.filter((route) => !isSameContact(route, routeToDelete));
    if (remainingRoutes.length === existingRoutes.length) {
        return;
    }
    if (store.collections instanceof Map) {
        if (remainingRoutes.length === 0) {
            store.collections.delete(aor);
        }
        else {
            store.collections.set(aor, remainingRoutes);
        }
        return;
    }
    yield store.delete(aor);
    for (const route of remainingRoutes) {
        yield store.put(aor, route);
    }
});
/**
 * A locator store that uses the location service to find routes for AORs.
 */
class Location {
    /**
     * Creates a new Location service. Should fail if any backend has sessionAffinity and round-robin
     *
     * @param {ILocatorStore} store - The store to use for the location service
     */
    constructor(store) {
        this.store = store;
        this.rrCount = new Map();
    }
    /** @inheritdoc */
    addRoute(request) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!request.aor.startsWith(AOR_SCHEME.SIP) &&
                !request.aor.startsWith(AOR_SCHEME.BACKEND)) {
                throw new errors_1.UnsupportedSchema(request.aor);
            }
            const existingRoutes = yield this.store.get(request.aor);
            const routeAlreadyExists = existingRoutes.some((route) => isSameContact(route, request.route));
            const routeToReplace = getWebSocketReplacementCandidate(existingRoutes, request.route, request.maxContacts, routeAlreadyExists);
            const effectiveContactCount = existingRoutes.length - (routeToReplace ? 1 : 0);
            if (!routeAlreadyExists &&
                request.maxContacts !== -1 &&
                effectiveContactCount >= request.maxContacts) {
                throw new common_1.CommonErrors.BadRequestError(`exceeds maximum of ${request.maxContacts} allowed contacts`);
            }
            if (routeToReplace) {
                yield deleteRouteContact(this.store, request.aor, routeToReplace);
            }
            return this.store.put(request.aor, request.route);
        });
    }
    /** @inheritdoc */
    findRoutes(request) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const formatLabels = (labelsMap) => {
                return Array.from(labelsMap)
                    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
                    .map(([key, value]) => `${key}=${value}`)
                    .join(";");
            };
            const labelString = request.labels ? formatLabels(request.labels) : null;
            const storeKeyWithLabels = labelString
                ? `${request.aor}:${request.callId}:${labelString}`
                : `${request.aor}:${request.callId}`;
            let routes = yield this.store.get(storeKeyWithLabels);
            if (routes && routes.length > 0) {
                return routes;
            }
            if (labelString) {
                const storeKey = `${request.aor}:${request.callId}:${labelString}`;
                routes = yield this.store.get(storeKey);
                if (!routes || routes.length === 0) {
                    routes = (yield this.store.get(request.aor)).filter((0, utils_1.filterOnlyMatchingLabels)(request.labels));
                }
            }
            else {
                routes = (_a = (yield this.store.get(request.aor))) !== null && _a !== void 0 ? _a : [];
            }
            const { backend } = request;
            if (!backend) {
                return routes;
            }
            // If it has no affinity session then get next
            const r = (backend === null || backend === void 0 ? void 0 : backend.withSessionAffinity) && request.sessionAffinityRef
                ? [yield this.nextWithAffinity(routes, request.sessionAffinityRef)]
                : [this.next(routes, request)];
            if (r.length > 0 && r[0]) {
                this.store.put(storeKeyWithLabels, r[0]);
                return r;
            }
            return [];
        });
    }
    /** @inheritdoc */
    removeRoutes(request) {
        return this.store.delete(request.aor);
    }
    next(routes, request) {
        var _a;
        const { backend } = request;
        const ref = (backend === null || backend === void 0 ? void 0 : backend.ref) || request.aor;
        if ((backend === null || backend === void 0 ? void 0 : backend.balancingAlgorithm) === common_1.CommonTypes.LoadBalancingAlgorithm.LEAST_SESSIONS) {
            return routes.sort((r1, r2) => r1.sessionCount - r2.sessionCount)[0];
        }
        // Continues using round-robin
        const nextPosition = (_a = this.rrCount.get(ref)) !== null && _a !== void 0 ? _a : 0;
        const result = routes[nextPosition];
        if (nextPosition >= routes.length - 1) {
            // Restarting round-robin counter
            this.rrCount.set(ref, 0);
        }
        else {
            this.rrCount.set(ref, nextPosition + 1);
        }
        return result;
    }
    // Backend with session affinity does not support round-robin
    nextWithAffinity(routes, sessionAffinityRef) {
        return __awaiter(this, void 0, void 0, function* () {
            const route = yield this.store.get(sessionAffinityRef);
            if (route.length > 0) {
                return route[0];
            }
            const r = routes.sort((r1, r2) => r1.sessionCount - r2.sessionCount)[0];
            this.store.put(sessionAffinityRef, r);
            return r;
        });
    }
}
exports.default = Location;
