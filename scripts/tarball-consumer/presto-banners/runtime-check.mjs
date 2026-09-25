// Runtime import of both packed entries in Node: the barrel must load without a DOM, and `register`
// must be a no-op where `customElements` does not exist (SSR hosts import it the same way).
import {
  BANNER_EVENTS,
  BANNER_STATES,
  definePrestoBanner,
  stateFromStatus,
} from "@alejoamiras/presto-banners";
import "@alejoamiras/presto-banners/register";

if (definePrestoBanner() !== false) {
  throw new Error("definePrestoBanner must be a no-op without customElements");
}
const unconfirmed = {
  available: false,
  reason: "secure-connection-unavailable",
  diagnosis: "unconfirmed",
};
if (stateFromStatus(unconfirmed) !== "offline") {
  throw new Error("stateFromStatus: an unconfirmed secure connection must map to offline");
}
if (!BANNER_STATES.includes("connect") || BANNER_EVENTS.connect !== "presto-banner:connect") {
  throw new Error("the packed dist must carry the connect state and its event");
}
console.log("runtime import OK: dist exports resolve and load");
