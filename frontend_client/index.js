import { registerGlobals } from "@livekit/react-native";

if (typeof global.DOMException === "undefined") {
  global.DOMException = class DOMException extends Error {
    constructor(message = "", name = "Error") {
      super(message);
      this.name = name;
    }
  };
}

registerGlobals();

console.log("[LiveKit] registerGlobals executed");

require("expo-router/entry");