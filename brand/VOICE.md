# How weichseltree writes and speaks

Drawn from `docs/LAWS.md`, which is Manuel's rulings on the videos, and from
the pages that ship. It applies to everything a visitor, a viewer, a
contributor or a sponsor reads or hears: README, release notes, the site, HUD
notices, narration, a tweet, a Show HN post, a Patreon update, a reply in an
issue.

## The voice in six lines

1. **Plain words.** Short sentences. The word a neighbour would use. If a
   term must be introduced, it is introduced once, with a picture, before it
   is used (LAWS 3).
2. **Numbers, and where they came from.** "2,634 particles at 30 fps is a
   few megabytes per minute." A spoken or written number names the thing that
   produced it when it matters (LAWS 24). Two significant figures unless the
   third one is the point.
3. **No hype.** Nothing is revolutionary, immersive, seamless, powerful,
   blazing, next-generation or the future of anything. Say what it does and
   what it costs.
4. **No repo-speak** (LAWS 5). Banned in anything a viewer reads or hears:
   *registered, card, P1, seed* (the tree's; the mark is "the seed"), *exit
   0, sigma* (say "one width"), experiment ids, commit hashes, check ids,
   "the pipeline", "the stack", "the backend". Those words are fine in
   docs/ and in an issue; they never reach narration, the site, a title or
   a thumbnail.
5. **First person, past tense, when Manuel speaks** (LAWS 6). "I ran it for
   400 tau and the rows never formed." Honest about mistakes; a mistake is a
   beat, never the whole act. The site and the HUD speak in the second
   person to the visitor ("you", "your browser") and never say "we" for one
   person; "we" is allowed once the orchard has a second operator.
6. **Wonder before mechanism** (LAWS 1). The first sentence shows the thing.
   The setup, the method and the caveat come after.

## Names

| write | never | note |
|---|---|---|
| weichseltree | Weichseltree, WeichselTree, WT | lower-case always, even at the start of a sentence; it is a word, not a brand in capitals |
| the orchard | the Orchard, Orchard™ | the platform and the repo; `orchard` in code font when it means the CLI |
| the grove | the Grove, the metaverse, the VR experience, the app | the public world; "walk into the grove", "in the grove" |
| the hall | the lobby, the hub | the first room; the operator's |
| the palace | the mansion (from now on) | where the hall is going; "the mansion" survives in older docs and in PLATFORM's phrase "a mansion that defies physics" |
| a room | a scene, a level, a space | one per tree |
| a tree | a project, a repo (to viewers), a partner | a research repo that registered |
| trees | the trees, the portfolio (to viewers) | plural, plain |
| the harvest | content, assets, deliverables | what a tree hangs |
| a tape | a dataset, a recording, a replay | a particle simulation you can stand in and scrub |
| a hanging, to hang | upload, publish, deploy (to viewers) | an exhibit in a room |
| the greenhouse | the admin panel, the backend | where rulings are made; admin only |
| a ruling | a decision, an approval (as a noun) | Manuel's word for a decision that becomes law |
| the fund | the budget, the treasury | it buys episode theses |
| the studio | the pipeline, the toolchain | it finishes episodes |
| a node | a server, an instance | one operator's orchard |
| a portal | a link, a teleporter | a doorway between rooms or orchards |
| the host | admin, moderator, staff | the person running this orchard, in the grove |
| a visitor | user, player, guest, member (unless they are one) | anyone in the grove; "member" is reserved for someone who pays or runs a node |
| an episode | a video, content | one viewer question, one number, one picture |
| the channel | the brand, our content | the YouTube series |
| the lane | the GPU, compute | in docs only; viewers never hear it |

Sentence case for headings. No exclamation marks. No emoji in anything
weichseltree publishes; the HUD, the site and the README use none.

## What never to say

- Anything untested as if it were tested. The hardware pass is open
  (BACKLOG 3): the site says "open this page in the Quest browser", not
  "works on Quest 3". Mainland reachability is unprobed; say so.
- "Free" for something that costs Manuel's time or the lane. Say what it
  costs.
- "Community" as a product. There are people who visit, people who fund,
  people who contribute. Name which.
- "AI-generated", "AI-powered". If a machine drafted a line, the line says
  what produced it (LAWS 9: provenance and disclosure); the platform is not
  sold on it.
- "Metaverse", "immersive", "experience" as a noun, "engage", "unlock" (the
  fund unlocks capital; a visitor unlocks nothing), "journey", "empower",
  "seamless", "cutting-edge", "state of the art", "leverage", "robust",
  "scalable", "ecosystem", "vision", "passionate", "excited to announce".
- "Simulation footage" that is interpolated, upscaled or generated (LAWS 9).
  Every particle is drawn where the tape put it, and the caption says which
  tape.
- Any claim about another orchard, tree or person's work that the person
  has not made themselves.
- "Donate". Someone funds a tree, sponsors the orchard, or runs a node.

## Examples

Wrong: *Experience the future of research visualisation in our immersive
WebXR metaverse, powered by cutting-edge AI.*
Right: *Walk inside a particle simulation. 2,634 particles, 801 frames, from
a headset, a laptop or a phone.*

Wrong: *P1 registered, exit 0, sigma 0.31.*
Right: *I let it run. After 400 time units the two kinds had sorted
themselves; the nearest stranger was nine times as far as the nearest
neighbour.*

Wrong: *Join our amazing community and unlock exclusive perks!*
Right: *Visitors need nothing. Members vote in the greenhouse on what gets
rendered next; €5 a month, cancel any time. Someone with a spare GPU can run
a node instead and fund a tree in kind.*

Wrong (HUD): *Oops! Something went wrong. Please try again later.*
Right (HUD): *Link lost. Reconnecting.* / *The wall's video is missing
(404). The tape still plays.*

## Narration in particular

The studio enforces LAWS 5 with a banned-word check and LAWS 16 with measured
takes. Beyond those: no number without its picture on screen; no term before
its introduction; silence longer than a beat is a failing check; at most five
takes per line. One voice for the channel, chosen by audition.
