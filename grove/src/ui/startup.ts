/** Keep a way out even when the 3D renderer or its module cannot start. */
export function startupFailed(): void {
  const status = document.querySelector<HTMLElement>("#boot-status");
  if (!status) return;
  status.hidden = false;
  status.dataset["failed"] = "true";
  status.querySelector("h1")!.textContent = "The Mind Palace could not open";
  status.querySelector("p")!.textContent = "Reload to try again. If the view still cannot open, check that your browser allows 3D graphics, or visit from another browser. You can return to the website without opening the 3D view.";
}

export function startupReady(): void {
  const status = document.querySelector<HTMLElement>("#boot-status");
  if (status) status.hidden = true;
}
