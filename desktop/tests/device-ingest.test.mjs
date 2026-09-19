import assert from "node:assert/strict";
import {
  applyDeviceHello,
  applyDeviceStatus,
  dedupePhones,
  isBaileysPhone,
} from "../src/store/deviceIngest.ts";

const hello = applyDeviceHello([], "phone-1", {
  name: "Pixel",
  model: "Pixel 8",
  battery: 40,
});
const updated = applyDeviceStatus(hello, "phone-1", {
  level: 41,
  charging: true,
  whatsappInstalled: true,
  accessibilityEnabled: false,
  overlayEnabled: true,
});

assert.deepEqual(updated[0], {
  ...hello[0],
  battery: 41,
  charging: true,
  whatsappInstalled: true,
  accessibilityEnabled: false,
  overlayEnabled: true,
});

// 多账号 deviceId 不应堆出多张 Baileys 卡
let multi = applyDeviceHello([], "wa-default", {
  name: "E",
  model: "Baileys",
  battery: 100,
});
multi = applyDeviceHello(multi, "wa-abc123", {
  name: "E",
  model: "Baileys",
  battery: 100,
});
multi = applyDeviceHello(multi, "baileys", {
  name: "E",
  model: "Baileys",
  battery: 100,
});
assert.equal(multi.filter((p) => isBaileysPhone(p)).length, 1);
assert.equal(multi.find((p) => isBaileysPhone(p))?.id, "baileys");

const dirty = dedupePhones([
  {
    id: "wa-1",
    name: "E",
    model: "Baileys",
    remark: "Baileys",
    online: true,
    battery: 100,
  },
  {
    id: "wa-2",
    name: "E",
    model: "Baileys",
    remark: "Baileys",
    online: true,
    battery: 100,
  },
  {
    id: "phone-1",
    name: "Pixel",
    model: "Pixel",
    remark: "Android Bridge",
    online: true,
    battery: 50,
  },
]);
assert.equal(dirty.length, 2);
assert.equal(dirty.filter((p) => p.remark === "Baileys").length, 1);

console.log("device-ingest.test.mjs ok");
