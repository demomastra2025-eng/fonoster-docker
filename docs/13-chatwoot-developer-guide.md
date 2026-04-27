# Chatwoot Developer Guide

## Purpose

This document explains what the Chatwoot-side developers should build and how they should talk to the bridge.

## Assumptions

- Chatwoot is on another server
- Chatwoot backend is Ruby on Rails
- Chatwoot frontend is Vue/Vite
- Chatwoot should not speak raw Fonoster SDK directly for everyday product actions

## Recommended Ownership

### Chatwoot Backend

Should own:

- user-facing telephony endpoints for the Chatwoot UI
- authentication and authorization
- persistence of Chatwoot-specific telephony mappings
- orchestration calls to the bridge

### Chatwoot Frontend

Should own:

- buttons and UI state
- call widgets
- operator actions
- status displays

The frontend should call Chatwoot backend, not the bridge directly, unless you intentionally expose the bridge inside your network perimeter.

## Suggested Rails Service Objects

Implement at least:

- `Telephony::BridgeClient`
- `Telephony::CallsService`
- `Telephony::RoutingService`
- `Telephony::AgentsService`
- `Telephony::WebphoneService`

## Suggested Rails Controllers

- `Api::Telephony::CallsController`
- `Api::Telephony::RoutingController`
- `Api::Telephony::AgentsController`
- `Api::Telephony::WebphoneController`

## Suggested Ruby Bridge Client

Use a dedicated client wrapper around HTTP calls to the bridge.

Example shape:

```ruby
require "net/http"
require "json"

module Telephony
  class BridgeClient
    def initialize(base_url:, secret: nil)
      @base_url = base_url
      @secret = secret
    end

    def get(path)
      request(Net::HTTP::Get.new(uri(path)))
    end

    def post(path, payload = {})
      req = Net::HTTP::Post.new(uri(path))
      req["Content-Type"] = "application/json"
      req.body = JSON.dump(payload)
      request(req)
    end

    private

    def uri(path)
      URI.join(@base_url, path)
    end

    def request(req)
      req["X-Bridge-Secret"] = @secret if @secret
      Net::HTTP.start(req.uri.hostname, req.uri.port, use_ssl: req.uri.scheme == "https") do |http|
        response = http.request(req)
        JSON.parse(response.body)
      end
    end
  end
end
```

## Recommended Chatwoot Backend Calls

### Outbound Call

Chatwoot backend -> bridge:

`POST /telephony/calls/outbound`

Ruby example:

```ruby
bridge.post("/telephony/calls/outbound", {
  from_number_ref: "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  to: "+15551234567",
  app_ref: "74fec1f6-48e8-436c-8147-9176a5da4fa4",
  metadata: {
    chatwoot_contact_id: 123,
    chatwoot_conversation_id: 456
  }
})
```

### Call History

Chatwoot backend -> bridge:

`GET /telephony/calls`

### Enable Or Disable Agent

Chatwoot backend -> bridge:

`POST /telephony/agents/:agentRef/enabled`

### Toggle AI

Chatwoot backend -> bridge:

`POST /telephony/ai/toggle`

Example:

```ruby
bridge.post("/telephony/ai/toggle", {
  number_ref: "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  enabled: true,
  ai_app_ref: "74fec1f6-48e8-436c-8147-9176a5da4fa4"
})
```

## Recommended Chatwoot Database Mappings

Store at least:

- `chatwoot_inbox_id -> fonoster_number_ref`
- `chatwoot_user_id -> fonoster_agent_ref`
- `chatwoot_conversation_id -> fonoster_call_ref`
- `chatwoot_contact_id -> normalized phone`
- AI mode policy per inbox or number

## What Chatwoot Developers Do Not Need To Build

Do not build these inside Chatwoot:

- SIP handling
- RTP/media handling
- direct Asterisk logic
- low-level carrier trunk management UI

Those remain in Fonoster and infrastructure.

## Frontend Notes

The Chatwoot frontend should call Chatwoot backend APIs such as:

- `POST /api/telephony/calls`
- `GET /api/telephony/calls`
- `POST /api/telephony/ai/toggle`
- `POST /api/telephony/agents/:id/enabled`

Do not embed raw Fonoster credentials in frontend code.

## First MVP For Chatwoot Developers

Build in this order:

1. outbound call button
2. recent call history panel
3. AI toggle by inbox or number
4. operator enable/disable
5. later: webphone token and browser calling
