import { parseMansion, type Mansion } from "./world/schema";

/** Synthetic fixtures are available only in Vite's development server. */
export function demoEnabled(development: boolean, search: string): boolean {
  return development && new URLSearchParams(search).has("demo");
}

/**
 * Keep the architecture, but replace every scientific hanging with clearly named
 * local fixtures. No content hash or live exhibit reference may survive: a
 * new contributor should not need the operator's bundles or cloud accounts.
 * The scene document itself is never changed.
 */
export function demoMansion(
  document: unknown,
  videoAvailable = import.meta.env.VITE_DEMO_VIDEO === "1",
): Mansion {
  const mansion = parseMansion(structuredClone(document));
  mansion.title = `${mansion.title} · local demo`;
  for (const room of mansion.rooms) {
    room.hangings = room.hangings.filter(
      (hanging) => hanging.kind === "tape" || (hanging.kind === "video" && videoAvailable),
    );
    for (const hanging of room.hangings) {
      if (hanging.kind === "tape") {
        hanging.title = "Synthetic particles · local demo";
        hanging.bundle = { id: "", path: "/dev-bundle/" };
        hanging.palette = [];
        hanging.pointSize = 14;
        hanging.variant = "";
      } else {
        hanging.title = "Synthetic test video · local demo";
        hanging.bundle = { id: "", path: "/dev-video/" };
      }
    }
  }
  // Land at something that plays, without a walk through an empty hall.
  const firstTapeRoom = mansion.rooms.find((room) => room.hangings.some((h) => h.kind === "tape"));
  if (firstTapeRoom) mansion.start = firstTapeRoom.id;
  return mansion;
}
