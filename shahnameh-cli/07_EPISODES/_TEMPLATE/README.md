# Episode folder template

Copy this folder to `07_EPISODES/SHM-EP0NN-<TITLE-SLUG>/` when an episode starts.

```
SHM-EP001-BIRTH-OF-ZAHHAK/
  SHOTLIST.csv          one row per shot — see columns below
  script/               script, beat sheet, narration
  boards/               storyboards / previz frames
  shots/                SHM-EP001-SC014-SH0030_V01_T01.mp4 etc.
  stills/               key frames pulled or generated per shot
```

`SHOTLIST.csv` columns:

```
shot_id,scene_id,sequence_id,description,location_id,characters,props,creatures,duration_s,status,take,notes
```

- `shot_id` — `SHM-EP001-SC014-SH0030`. Count shots in **tens** so you can insert later.
- `location_id` / `characters` / `props` / `creatures` — entity IDs from
  `00_PROJECT/registry/ENTITIES.csv`, semicolon-separated. Never re-describe an asset here;
  point at its ID.
- `status` — `TODO` / `PROMPTED` / `GENERATED` / `APPROVED` / `LOCKED`.

Register the episode itself as a row in `00_PROJECT/registry/EPISODES.csv` before you start.
