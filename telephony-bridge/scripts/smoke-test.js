#!/usr/bin/env node

const { randomUUID } = require("node:crypto");
const { existsSync } = require("node:fs");

const baseUrl =
  process.env.TELEPHONY_BRIDGE_SMOKE_BASE_URL ||
  process.env.TELEPHONY_BRIDGE_BASE_URL ||
  `http://127.0.0.1:${
    process.env.TELEPHONY_BRIDGE_PORT || (existsSync("/.dockerenv") ? "3100" : "38081")
  }`;
const sharedSecret = process.env.TELEPHONY_BRIDGE_SHARED_SECRET || "";
const accountId = process.env.TELEPHONY_BRIDGE_ONELINK_ACCOUNT_ID || "1";
const ingressNumber =
  process.env.TELEPHONY_BRIDGE_SMOKE_INGRESS_NUMBER || "+18623964686";
const callerNumber =
  process.env.TELEPHONY_BRIDGE_SMOKE_CALLER_NUMBER || "+77066318623";
const runtimeAppRef =
  process.env.TELEPHONY_BRIDGE_RUNTIME_APP_REF ||
  process.env.TELEPHONY_BRIDGE_DEFAULT_APP_REF ||
  "96fc259c-6bcd-4cbf-bb7d-d2c51f248934";

function buildHeaders(extra = {}) {
  return {
    accept: "application/json",
    ...(sharedSecret ? { "x-bridge-secret": sharedSecret } : {}),
    ...(accountId ? { "x-account-id": accountId } : {}),
    ...extra
  };
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (_error) {
    return { raw: text };
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: buildHeaders(options.headers || {})
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  return { response, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const routeCallRef = `smoke-route-${randomUUID()}`;
  const eventCallRef = `smoke-event-${randomUUID()}`;
  const runtimeCallRef = `smoke-runtime-${randomUUID()}`;

  const health = await request("/healthz");
  assert(health.payload.ok === true, "healthz did not return ok=true");
  console.log("ok healthz");

  const summary = await request("/telephony/resources/summary");
  assert(
    Number(summary.payload?.counts?.numbers || 0) >= 1,
    "resources summary did not include a number"
  );
  console.log("ok resources/summary");

  const state = await request("/telephony/events/state");
  assert(state.payload.streamState, "events/state did not return streamState");
  console.log("ok events/state");

  const events = await request("/telephony/events/poll?limit=1");
  assert(Array.isArray(events.payload.items), "events/poll did not return items");
  console.log("ok events/poll");

  if (sharedSecret) {
    const route = await request("/internal/voice/inbound/route", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": routeCallRef
      },
      body: JSON.stringify({
        appRef: runtimeAppRef,
        app_ref: runtimeAppRef,
        callRef: routeCallRef,
        call_ref: routeCallRef,
        bridgeCallRef: routeCallRef,
        bridge_call_ref: routeCallRef,
        provider_call_id: routeCallRef,
        runtimeCallRef,
        runtime_call_ref: runtimeCallRef,
        ingressNumber,
        ingress_number: ingressNumber,
        callerNumber,
        caller_number: callerNumber,
        direction: "FROM_PSTN",
        receivedAt: new Date().toISOString(),
        received_at: new Date().toISOString(),
        metadata: { smoke: true }
      })
    });
    assert(route.payload.action, "internal route did not return an action");
    assert(
      route.payload.bridge_call_ref === routeCallRef ||
        route.payload.bridgeCallRef === routeCallRef,
      "internal route did not preserve bridge_call_ref"
    );
    console.log(`ok internal route (${route.payload.action})`);

    const event = await request("/internal/voice/inbound/event", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": eventCallRef,
        "x-idempotency-key": `${eventCallRef}-session-started`
      },
      body: JSON.stringify({
        eventType: "session_started",
        callRef: eventCallRef,
        call_ref: eventCallRef,
        bridgeCallRef: eventCallRef,
        bridge_call_ref: eventCallRef,
        provider_call_id: eventCallRef,
        runtimeCallRef,
        runtime_call_ref: runtimeCallRef,
        appRef: runtimeAppRef,
        ingressNumber,
        ingress_number: ingressNumber,
        callerNumber,
        caller_number: callerNumber,
        direction: "FROM_PSTN",
        metadata: { smoke: true }
      })
    });
    assert(event.payload.accepted === true, "internal event was not accepted");
    console.log("ok internal event accepted");

    const eventPoll = await request(
      `/telephony/calls/${encodeURIComponent(eventCallRef)}/events/session_started/poll?limit=1&timeout_ms=250`
    );
    const storedEvent = eventPoll.payload.items?.[0];
    assert(storedEvent, "session_started event was not visible in stream");
    assert(
      storedEvent.data?.bridge_call_ref === eventCallRef ||
        storedEvent.data?.bridgeCallRef === eventCallRef,
      "stored event did not preserve bridge_call_ref"
    );
    assert(
      storedEvent.data?.runtime_call_ref === runtimeCallRef ||
        storedEvent.data?.runtimeCallRef === runtimeCallRef,
      "stored event did not preserve runtime_call_ref"
    );
    console.log("ok canonical correlation fields");
  } else {
    console.log("skip internal route/event: TELEPHONY_BRIDGE_SHARED_SECRET not set");
  }
}

run().catch((error) => {
  console.error(`smoke failed: ${error.message}`);
  process.exit(1);
});
