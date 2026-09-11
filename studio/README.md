# studio

Not built yet. What lands here, and where it comes from:

- `storyboard.py`: phototroph `studio/ptstudio/films/storyboard.py` (schema,
  20 rules, concept ledger), extended with the story spine: question, wonder
  shot, intuition, mechanism, measurement, what is open. spectre's markdown
  storyboards import into it.
- `narrate.py`: phototroph `post/narrate.py` (max-of-N takes, ffprobe
  durations, hash cache) with spectre `core/film/audio/vo.py`'s content-hash
  layout; take cap 5, ceiling 10; metered into the ledger.
- `checks/`: vocabulary chain across the series, banned words (LAWS 5),
  silence per shot (LAWS 17), episode contact sheet (LAWS 15), spoken-number
  provenance (LAWS 24), persona reviews (LAWS 23).
- `render/`: plugins behind spectre's tape format: flat (einstruct
  `film/render.py`) for animatics, Mitsuba (spectre `core/film/mts`) and
  Blender 4.2 (`~/tools/blender`) for hero shots; render and composite split;
  `budget.py` from phototroph with measured coefficients.
- `finish/`: assemble (einstruct `film/assemble.py` + phototroph OTIO), music
  bed and ducking, titles and chapters, thumbnails, YouTube metadata.
