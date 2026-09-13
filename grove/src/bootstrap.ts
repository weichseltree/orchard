import { startupFailed } from "./ui/startup";

document.querySelector("#reload-grove")?.addEventListener("click", () => location.reload());
window.setTimeout(() => {
  const status = document.querySelector<HTMLElement>("#boot-status");
  if (!status || status.hidden || status.dataset["failed"]) return;
  status.querySelector("p")!.textContent = "The first room is taking longer to arrive. You can keep waiting, reload, or return to the website.";
}, 12_000);

// Only the startup side effects are needed. Discarding the module namespace
// keeps Rolldown's interop helper from making the deferred presence SDK a
// static dependency of main; quality:build measures the emitted import graph.
void import("./main").then(() => undefined).catch((error: unknown) => {
  console.error("[grove] startup failed", error);
  startupFailed();
});
