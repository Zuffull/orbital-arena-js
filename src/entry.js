import { startLocalGame } from "./local-game.js";
if (new URLSearchParams(location.search).has("experiment")) void import("./main.js");
else startLocalGame();
