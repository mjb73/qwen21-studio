# Qwen-Image Studio

A single-page studio for local diffusion models on top of **ComfyUI** — pick a model, type a
prompt, render, then crop, adjust and export without leaving the tab. It talks to ComfyUI over
HTTP, so ComfyUI can be anywhere you can reach.

It is the generation engine behind [PhotoCraft AI](https://github.com/mjb73/cutout-studio), but it
runs on its own.

    ./start.sh                  # http://127.0.0.1:7866
    PORT=9000 ./start.sh        # another port

## What it needs

* **Python 3.10+** (3.12 recommended).
* **A running ComfyUI** — default `http://localhost:8188`. If nothing answers there the app starts
  one from the folder you set in the Models tab, using that install's own python.
* **Model files you supply**: a diffusion model, a text encoder and a VAE for each model you want
  to use. See *Models* below.

The bundled workflows use core ComfyUI nodes only; ComfyUI-Manager is not required.

## First run — the Models tab

The app knows nothing about your disk until you tell it, which is deliberate: file names are not
portable. Open **Models** (third tab, next to Defaults) and:

1. Set the **ComfyUI root directory** — **Detect** tries the usual places, **Scan folder** lists
   what is actually there.
2. Press **+ Add model**, choose the diffusion model file, then **Guess encoder + VAE**. The guess
   reads the file name for its family (Qwen-Image, Z-Image, Krea, Ernie/Flux, Moss) and fills in a
   matching text encoder, encoder type and VAE.
3. Fix anything the guess got wrong and press **Save models**. The Defaults tab grows a sub-tab for
   the model and the Prompt tab's model list gains it.

`model_dirs` in `config.json` decides where each kind is searched for (relative to the ComfyUI root
unless absolute) — add your own directories if your models live outside a stock ComfyUI layout:

```json
"model_dirs": {
  "unet":         ["models/diffusion_models", "models/unet"],
  "text_encoder": ["models/text_encoders", "models/clip"],
  "vae":          ["models/vae"]
}
```

### Why one model is three files

A diffusion model only renders when paired with the text encoder it was trained against and that
family's VAE. The wrong pairing usually does not error — it produces garbage — which is why those
pairings are stored explicitly rather than guessed at render time.

| Field | Meaning |
|---|---|
| Model file | the diffusion model — `UNETLoader` for `.safetensors`, `UnetLoaderGGUF` for `.gguf` |
| Text encoder | the CLIP / text-encoder file for that family |
| Encoder type | ComfyUI's CLIP type (`qwen_image`, `lumina2`, `krea2`, `flux2`, `moss_image`, …) |
| VAE | the VAE file for that family |

Steps, CFG, sampler and scheduler travel with the model too: the Defaults tab edits them per model
and per mode (T2I / I2I), and the Prompt tab can override them for a single render.

## Using it

* **Prompt** — prompt, model, sampling, dimensions, LoRAs. *Generate* queues a render; the queue
  strip shows each job and its state.
* **Defaults** — per-model numbers (steps, CFG, sampler, scheduler, denoise, megapixels, aspect
  ratio, LoRA defaults) for T2I and I2I, plus **Chain**: two models in series, the first pass
  denoised into the second — a fast turbo pass followed by a detail pass.
* **Models** — the folder and the registry, as above.

Renders land in ComfyUI's `output/` and are listed in the app, where they can be cropped,
colour-adjusted and exported from the same page.

## Configuration

`config.json` is created on first start from `config.example.json` and is git-ignored — it holds
your paths. `user_settings.json` (also git-ignored) holds per-model defaults and the last UI state.

| Key | Meaning |
|---|---|
| `comfy_host` | ComfyUI URL, e.g. `http://localhost:8188` |
| `comfy_root` | ComfyUI folder — models, `input/`, and where it is started from |
| `comfy_python` | that ComfyUI's python (only needed to auto-start it) |
| `output_dir` | where renders land (defaults to `<comfy_root>/output`) |
| `loras_root` | LoRAs, scanned per model folder |
| `models` | the registry — written by the Models tab |

## HTTP API

The UI is a static page over a small JSON API; everything the app does is reachable:

    GET  /api/config          models, presets, defaults, current paths
    GET  /api/registry        folder, scanned files, saved pairings
    POST /api/registry        save folder + pairings (writes config.json)
    POST /api/detect_comfy    look for a ComfyUI install in the usual places
    POST /api/generate        queue a render        GET /api/status?prompt_id=…
    GET  /api/view?filename=… fetch a finished image
    POST /api/defaults        per-model defaults (load / save / reset)

## Layout

| Path | Purpose |
|---|---|
| `server.py` | FastAPI server: the API above, the ComfyUI launch, image post-processing |
| `shared.py` | config, model registry and discovery, presets, LoRA scanning, workflow helpers |
| `index.html`, `styles.css`, `js/` | the UI (`js/models.js` is the Models tab) |
| `workflow.json`, `workflow-api.json` | the ComfyUI graph and its API form |
| `config.example.json` | template for the git-ignored `config.json` |
| `docs/NOTES.md` | implementation notes kept from the original build |

MIT licensed — see `LICENSE`. Model weights are yours to supply and carry their own licences;
nothing is downloaded here.
