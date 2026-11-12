# Development notes

Implementation notes kept from the original single-machine build: the PhotoCraft AI column layout,
the folded Generation Setup, post-processing layers and the queue row. Nothing here is needed to run the app.

### Models

The T2I model list is a family list, each entry paired with a preset that supplies its text encoder,
clip type, VAE, sampler and step count:

| model | preset | encoder / clip type | VAE | steps |
|---|---|---|---|---|
| `qwen_image_2.1_int8_convrot.safetensors` | `qwen21` | `qwen3vl_8b_int8_convrot` / `qwen_image` | `qwen_image_2.1_vae_bf16` | 25 |
| `qwen-image-2.1-Q4_K_M.gguf`, `Q8_0.gguf` | `qwen21` | same as above | same | 25 |
| `ernie-image-turbo.safetensors` | `ernie` | `ministral-3-3b` / `flux2` | `flux2-vae` | 8 |
| `jibMixErnie_v20.safetensors` | `jibMixErnie` | `ministral-3-3b` / `flux2` (+ PAG 0.65) | `flux2-vae` | 8 |
| `z_image_turbo_bf16.safetensors` | `z_image_turbo` | `qwen_3_4b` / `lumina2` | `Turbo_z_ae` | 8 |
| `z-anime-distill-4step-bf16.safetensors` | `z_anime` | `qwen_3_4b` / `lumina2` | `Turbo_z_ae` | 4 |
| `krea2_turbo_fp8_scaled.safetensors` | `krea2_turbo` | `qwen3vl_4b_fp8_scaled` / `krea2` | `qwen_image_vae` | 8 |

Weights are read from the shared ComfyUI store via `extra_model_paths.yaml`, so nothing is copied into
`models-qwen21/`. The list comes from `unet_models` in `config.json` plus a disk scan: Qwen-2.1 files are
found by name, any other family only when the config names it (each needs its preset — a stray file from
one of those families would load and then sample with the wrong encoder and VAE).

Selecting a model in the UI applies that model's preset immediately (clip, clip type, VAE, sampler,
steps, CFG, LoRAs); whatever you then change is saved per model and per mode.

### The column runs top to bottom, and Generate closes it

In the PhotoCraft AI panel the studio is one 430 px column, and the sequence is deliberate:

    Prompt | Defaults      ← sub-tabs, pinned under the panel's own Generate / Cutout tabs
    Status, CPU/RAM/GPU    ← what the machine is doing
    Prompt                 ← what is being asked for
    Generation Setup       ← folded: the numbers behind it
    Post-processing        ← folded: what happens to the picture afterwards
    queue + Generate Image ← the action, at the foot of the column
    Generated images go to … (the panel), then the log (the panel)

Two rules make that hold. The sub-tab bar is the only thing left in `#stickyHeader` — the Generate bar
used to live there, and a button at the top of a column whose content it acts on is what made the
layout read oddly. In the photocraft theme (i.e. inside the panel) that header is `position: static`:
the column there is short and never needs pinning, and a pinned header is what cut the top off the
Status row the moment the frame scrolled a few pixels. The 4 px breathing space under the tabs is
`padding-bottom` on the header itself, not the old `::after` strip — that strip was painted *below*
the header's box and so covered the first pixels of whatever followed it, which is what made the
Status row look half eaten rather than merely scrolled. And `#generateDock` (queue + bar) is pushed to the bottom by
`.container { display: flex; flex-direction: column; min-height: calc(100vh - var(--topbar-h)) }`
with `margin-top: auto` and `position: sticky; bottom: 0`, so spare height collects *above* the
button instead of beneath it and the button stays reachable when the Defaults tab is long.
`.container > * { flex: 0 0 auto }` is required: without it the prompt panel is what gives way when
the column runs out of room.

### Generation Setup is folded, and the parameters are number fields

The setup block ships as a concertina header, **collapsed by default** (`localStorage`
`qwen21_genSetupCollapsed`, absent = folded), because in the PhotoCraft column the prompt and Generate
have to be reachable without scrolling. The header carries the state at a glance — `T2I · 25 steps ·
9:16 · <model>` — so a shut section still answers what the next run will use; the model is last because
that is the part allowed to truncate. The choice is remembered once you open it.

Every slider is a plain number field (`input[type=number] class="num"`, no spinner), so Steps, CFG and
Denoise share one row and PAG sits beside Seed: a parameter row is 41 px instead of ~135 px. The 450 px
`max-width` media query in `styles.css` normally stacks all rows (the column is 430 px) — the photocraft
theme overrides it, otherwise three fields become three full-width rows.

**Prompt → Paste** (small button beside the label) reads the clipboard into `#positivePrompt` and
**replaces what was there** — the button means "make this the prompt", so the old text goes; Ctrl+V in
the field is the caret-insert route. It then fires `input`/`change` so the autosave and the setup
summary follow, and the status reads how many characters arrived. It is a real `navigator.clipboard.readText()`, so it needs a
secure context (localhost or https) and Chrome asks once whether the panel may read the clipboard;
the host page must delegate the feature to the frame — the panel's iframe carries
`allow="clipboard-read; clipboard-write"`. Served over plain http on a LAN address the API does not
exist, and the button says so instead of doing nothing: it puts the caret back in the field and the
status reads “Clipboard needs https or localhost — press Ctrl+V in the prompt”.

The readout spans that used to sit under each slider are gone; the `*Val` exports in `state-v2.js` now
point at one inert sink so the many `state.xVal.textContent = v` mirrors (presets, restores, defaults)
stay harmless.

### Post-processing — Vibrance and Curves layers in PhotoCraft

A second concertina, folded by default, sits directly under Generation Setup and is **one row**:
`☐ Vibrance` and `☐ Curves`. These do not touch the render — they act on the picture **open in
PhotoCraft**, adding an adjustment layer above its active layer with the values that picture's own
finishing layers carry (the defaults live in the panel's `services.py`, not here), which is why
there is nothing to type. The name is the button that adds another layer; the checkbox is a standing
choice — ticked, every picture the engine delivers afterwards arrives already finished with that
adjustment, and ticking also applies it to what is open now (added if missing, shown if hidden).
Unticking hides the layers of that kind rather than deleting them. The choice is kept panel-side, so
it survives a reload of either window.

`js/adjustments.js` owns it and talks to the panel over `postMessage` — the panel is the only side
with a bridge to PhotoCraft, and the two apps are on different ports, so `ask()` posts
`{type:"photocraft-ai-postprocess", id, action, kind}` and waits for the matching reply. Actions are
`add`, `toggle` and `state`; the section reads `state` on load and each time it is opened, so the
header describes what is really in the document while the boxes keep the user's standing choice.
The panel also pushes `photocraft-ai-delivered` into the frame whenever a render lands, so the header
does not sit there stale after a generation. Outside the panel (`window.parent === window`) there is
no editor, and a press says so instead of failing silently.

## Requirements

| Component | Notes |
|-----------|-------|
| **ComfyUI** | Must be running on port 8188 (auto-launched if using the launcher dashboard) |
| **Ernie Image Turbo model** | `ernie-image-turbo.safetensors` (~15 GB fp16) in `ComfyUI/models/checkpoints/` |
| **VRAM** | ~8-12 GB depending on resolution and batch size |

## Files

| File | Purpose |
|------|---------|
| `server.py` | FastAPI web server |
| `index.html` | Web UI with prompt builder and post-processing |
| `config.json` | Server and model configuration |
| `workflow.json` | ComfyUI workflow template |
| `workflow-api.json` | API-compatible workflow format |
| `shared.py` | Shared utilities |
