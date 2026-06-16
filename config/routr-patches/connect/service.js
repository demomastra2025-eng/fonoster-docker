"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.routeWebSocketDialogRequest = void 0;
exports.default = connectProcessor;
const common_1 = require("@routr/common");
const location_1 = require("@routr/location");
const processor_1 = __importStar(require("@routr/processor"));
const common_2 = require("@routr/common");
const function_1 = require("fp-ts/function");
const logger_1 = require("@fonoster/logger");
const request_1 = require("./handlers/request");
const registry_1 = require("./handlers/registry");
const register_1 = require("./handlers/register");
const logger = (0, logger_1.getLogger)({ service: "connect", filePath: __filename });
const isWebSocketTransport = (transport) => {
    const normalized = transport === null || transport === void 0 ? void 0 : transport.toUpperCase();
    return normalized === common_1.Transport.WS || normalized === common_1.Transport.WSS;
};
const selectNewestWebSocketRoute = (routes) => routes
    .filter((route) => isWebSocketTransport(route.transport))
    .sort((a, b) => (b.registeredOn || 0) - (a.registeredOn || 0))[0];
const isUnroutableWebSocketContact = (req) => {
    var _a;
    const uri = req.message.requestUri;
    return (((_a = uri === null || uri === void 0 ? void 0 : uri.host) === null || _a === void 0 ? void 0 : _a.endsWith(".invalid")) ||
        isWebSocketTransport(uri === null || uri === void 0 ? void 0 : uri.transportParam));
};
const toAor = (uri) => (uri === null || uri === void 0 ? void 0 : uri.user) && (uri === null || uri === void 0 ? void 0 : uri.host) ? `sip:${uri.user}@${uri.host}` : undefined;
const unique = (value, index, values) => value && values.indexOf(value) === index;
const routeWebSocketDialogRequest = (location, req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    if (!isUnroutableWebSocketContact(req)) {
        return undefined;
    }
    const candidateAors = [
        toAor((_b = (_a = req.message.to) === null || _a === void 0 ? void 0 : _a.address) === null || _b === void 0 ? void 0 : _b.uri),
        toAor((_d = (_c = req.message.from) === null || _c === void 0 ? void 0 : _c.address) === null || _d === void 0 ? void 0 : _d.uri)
    ].filter(unique);
    for (const aor of candidateAors) {
        try {
            const route = selectNewestWebSocketRoute(yield location.findRoutes({ aor, callId: req.ref }));
            if (route && isWebSocketTransport(route.transport)) {
                logger.verbose("routing dialog request through registered websocket contact", {
                    ref: req.ref,
                    method: req.method,
                    aor,
                    contactHost: route.host,
                    contactPort: route.port,
                    transport: route.transport
                });
                return (0, function_1.pipe)(req, processor_1.Alterations.decreaseMaxForwards, processor_1.Alterations.addSelfVia(route), processor_1.Alterations.addRouteToNextHop(route), processor_1.Alterations.removeSelfRoutes);
            }
        }
        catch (err) {
            logger.warn("failed to lookup websocket dialog route", {
                ref: req.ref,
                method: req.method,
                aor,
                error: err instanceof Error ? err.message : String(err)
            });
        }
    }
    return undefined;
});
exports.routeWebSocketDialogRequest = routeWebSocketDialogRequest;
// eslint-disable-next-line require-jsdoc
function connectProcessor(config) {
    const { bindAddr, locationAddr } = config;
    const location = new location_1.LocationClient({ addr: locationAddr });
    new processor_1.default({ bindAddr, name: "connect" }).listen((req, res) => __awaiter(this, void 0, void 0, function* () {
        logger.verbose("connect processor received new request", {
            ref: req.ref,
            method: req.method,
            type: req.message.messageType === common_2.CommonTypes.MessageType.RESPONSE
                ? "(response)"
                : "(request)",
            edgePort: req.edgePortRef
        });
        logger.silly(JSON.stringify(req, null, " "));
        // If it is a response simply forwards to uac
        if (processor_1.Helper.isTypeResponse(req)) {
            // Remove the proxy and overwrite the contact with the sender info
            return res.send(
            // NOTE: We should consider making the overwriteContactWithSenderInfo an Agent/Peer level alteration
            // pipe(req, A.overwriteContactWithSenderInfo, A.removeTopVia)
            (0, function_1.pipe)(req, processor_1.Alterations.removeTopVia));
        }
        switch (req.method) {
            case common_1.Method.PUBLISH:
            case common_1.Method.NOTIFY:
            case common_1.Method.SUBSCRIBE:
            case common_1.Method.MESSAGE:
                res.sendMethodNotAllowed();
                break;
            case common_1.Method.REGISTER:
                if (processor_1.Extensions.getHeaderValue(req, common_2.CommonTypes.ExtraHeader.GATEWAY_AUTH)) {
                    (0, registry_1.handleRegistry)(req, res);
                }
                else {
                    (0, register_1.handleRegister)(common_2.CommonConnect.apiClient({ apiAddr: config.apiAddr }), location)(req, res);
                }
                break;
            case common_1.Method.BYE:
            case common_1.Method.ACK:
                const dialogRequest = yield (0, exports.routeWebSocketDialogRequest)(location, req);
                if (dialogRequest) {
                    res.send(dialogRequest);
                    break;
                }
                res.send((0, function_1.pipe)(req, processor_1.Alterations.decreaseMaxForwards, processor_1.Alterations.addSelfViaUsingExternalAddrs, processor_1.Alterations.removeSelfRoutes));
                break;
            default:
                (0, request_1.handleRequest)(location, common_2.CommonConnect.apiClient({ apiAddr: config.apiAddr }))(req, res);
        }
    }));
}
