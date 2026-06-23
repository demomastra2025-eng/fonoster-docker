const test = require("node:test");
const assert = require("node:assert/strict");

process.env.TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_ID ||= "test-access-key";
process.env.TELEPHONY_BRIDGE_FONOSTER_ENDPOINT ||= "localhost:50051";
process.env.TELEPHONY_BRIDGE_FONOSTER_USERNAME ||= "test-user";
process.env.TELEPHONY_BRIDGE_FONOSTER_PASSWORD ||= "test-password";

require("../src/fonoster");

const {
  CreateTrunkRequest,
  UpdateTrunkRequest
} = require("@fonoster/sdk/dist/node/generated/node/trunks_pb");

function hex(buffer) {
  return Buffer.from(buffer).toString("hex");
}

test("create trunk serializes explicit sendRegister=false", () => {
  const request = new CreateTrunkRequest();
  request.setName("analog-trunk");
  request.setInboundUri("analog.example.test");
  request.setSendRegister(false);

  assert.equal(request.getSendRegister(), false);
  assert.match(hex(request.serializeBinary()), /1000/);
});

test("update trunk serializes explicit sendRegister=false", () => {
  const request = new UpdateTrunkRequest();
  request.setRef("analog-trunk");
  request.setName("analog-trunk");
  request.setInboundUri("analog.example.test");
  request.setSendRegister(false);

  assert.equal(request.getSendRegister(), false);
  assert.match(hex(request.serializeBinary()), /1800/);
});
