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
exports.handleRegister = void 0;
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
const grpc = __importStar(require("@grpc/grpc-js"));
const location_1 = require("@routr/location");
const processor_1 = require("@routr/processor");
const common_1 = require("@routr/common");
const utils_1 = require("../utils");
const logger_1 = require("@fonoster/logger");
const logger = (0, logger_1.getLogger)({ service: "connect", filePath: __filename });
const jwtVerifier = (0, utils_1.getVerifierImpl)();
const handleRegister = (apiClient, location) => {
    return (request, res) => __awaiter(void 0, void 0, void 0, function* () {
        // Calculate and return challenge
        if (request.message.authorization) {
            const auth = Object.assign({}, request.message.authorization);
            auth.method = request.method;
            const fromURI = request.message.from.address.uri;
            const peerOrAgent = (yield (0, utils_1.findResource)(apiClient, fromURI.host, fromURI.user));
            if (!peerOrAgent) {
                return res.send(common_1.CommonResponse.createForbiddenResponse());
            }
            const credentials = peerOrAgent.credentials;
            // Calculate response and compare with the one send by the endpoint
            const calcRes = common_1.Auth.calculateAuthResponse(auth, {
                username: credentials === null || credentials === void 0 ? void 0 : credentials.username,
                secret: credentials === null || credentials === void 0 ? void 0 : credentials.password
            });
            if (calcRes !== auth.response) {
                return res.send(common_1.CommonResponse.createUnauthorizedResponse(request.message.requestUri.host));
            }
            try {
                yield location.addRoute({
                    aor: "aor" in peerOrAgent ? peerOrAgent.aor : processor_1.Target.getTargetAOR(request),
                    route: location_1.Helper.createRoute(request),
                    maxContacts: peerOrAgent.maxContacts
                });
                res.sendRegisterOk(request);
            }
            catch (e) {
                if (e.code === grpc.status.INVALID_ARGUMENT) {
                    const details = e.details;
                    res.sendForbidden(details);
                    logger.verbose(details);
                    return;
                }
                logger.error(e);
                res.sendInternalServerError();
            }
        }
        else if ((0, utils_1.hasXConnectObjectHeader)(request)) {
            const connectToken = processor_1.Extensions.getHeaderValue(request, common_1.CommonTypes.ExtraHeader.CONNECT_TOKEN);
            try {
                const payload = (yield jwtVerifier.verify(connectToken));
                if (!payload.allowedMethods.includes(common_1.Method.REGISTER)) {
                    return res.send(common_1.CommonResponse.createForbiddenResponse());
                }
                yield location.addRoute({
                    aor: payload.aor,
                    route: location_1.Helper.createRoute(request),
                    maxContacts: payload.maxContacts || -1
                });
                res.sendRegisterOk(request);
            }
            catch (e) {
                logger.verbose("unable to validate connect token", {
                    originalError: e.message
                });
                res.send(common_1.CommonResponse.createForbiddenResponse());
            }
        }
        else {
            res.send(common_1.CommonResponse.createUnauthorizedResponse(request.message.requestUri.host));
        }
    });
};
exports.handleRegister = handleRegister;
